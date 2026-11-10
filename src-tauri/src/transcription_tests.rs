use super::*;
use std::io::{Read, Write};

// Explicit opt-in: uploads the selected recording to the configured service.
// Keeps credentials and transcript contents out of test output.
#[test]
#[ignore = "uploads real audio; requires explicit settings, audio, and output paths"]
fn live_compressed_upload() {
    let env_path = |name| PathBuf::from(std::env::var(name).expect(name));
    let settings_path = env_path("VERBA_LIVE_UPLOAD_SETTINGS");
    let audio_path = env_path("VERBA_LIVE_UPLOAD_AUDIO");
    let output_path = env_path("VERBA_LIVE_UPLOAD_OUTPUT");
    let settings: Settings = serde_json::from_slice(&fs::read(settings_path).unwrap()).unwrap();
    assert!(!settings.api_key.trim().is_empty(), "API key is required");
    let original = fs::read(&audio_path).unwrap();
    let mut wav = hound::WavReader::open(&audio_path).unwrap();
    let spec = wav.spec();
    let duration_seconds = f64::from(wav.duration()) / f64::from(spec.sample_rate);
    let mut original_samples = wav.samples::<i16>();
    fs::create_dir(&output_path).expect("choose a new verification output directory");

    let cancelled = Arc::new(AtomicBool::new(false));
    let prepared = audio_upload::prepare(&audio_path, &cancelled).unwrap();
    let part_count = prepared.parts.len();
    let mut compressed_bytes = 0;
    for (index, part) in prepared.parts.iter().enumerate() {
        let bytes = fs::metadata(part).unwrap().len();
        assert!(bytes <= audio_upload::MAX_UPLOAD_BYTES as u64);
        compressed_bytes += bytes;
        let mut decoder = claxon::FlacReader::open(part).unwrap();
        let info = decoder.streaminfo();
        assert_eq!(info.sample_rate, spec.sample_rate);
        assert_eq!(info.channels, u32::from(spec.channels));
        assert_eq!(info.bits_per_sample, u32::from(spec.bits_per_sample));
        for sample in decoder.samples() {
            assert_eq!(
                sample.unwrap(),
                i32::from(original_samples.next().unwrap().unwrap()),
                "compressed audio must preserve every sample in order"
            );
        }
        fs::copy(part, output_path.join(format!("part-{}.flac", index + 1))).unwrap();
    }
    assert!(original_samples.next().is_none(), "audio tail was omitted");
    drop(prepared);
    println!(
        "Verified lossless audio: {duration_seconds:.3}s, {} bytes -> {compressed_bytes} bytes, {part_count} part(s)",
        original.len()
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(API_CLIENT_TIMEOUT_SECS))
        .build()
        .unwrap();
    let progress = Mutex::new(Vec::new());
    let started = Instant::now();
    let transcript = tauri::async_runtime::block_on(transcribe_audio(
        &client,
        &settings,
        &[],
        &audio_path,
        cancelled,
        |part, total| {
            println!("Uploading compressed audio {part}/{total}");
            progress.lock().unwrap().push((part, total));
        },
    ))
    .expect("live compressed upload failed");
    let elapsed_seconds = started.elapsed().as_secs_f64();
    assert_eq!(
        *progress.lock().unwrap(),
        (1..=part_count)
            .map(|i| (i, part_count))
            .collect::<Vec<_>>()
    );
    assert_eq!(fs::read(&audio_path).unwrap(), original);
    fs::write(output_path.join("Transcript.txt"), &transcript).unwrap();
    let report = serde_json::json!({
        "api_base_url": settings.api_base_url,
        "model": settings.whisper_model,
        "audio_seconds": duration_seconds,
        "original_bytes": original.len(),
        "compressed_bytes": compressed_bytes,
        "parts": part_count,
        "lossless_samples_verified": true,
        "original_unchanged": true,
        "production_upload_succeeded": true,
        "transcript_characters": transcript.chars().count(),
        "encode_and_upload_seconds": elapsed_seconds
    });
    fs::write(
        output_path.join("verification.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    println!(
        "Live upload passed: {} transcript characters in {elapsed_seconds:.1}s; original audio unchanged",
        transcript.chars().count()
    );
}

fn server(responses: Vec<(u16, &'static str)>) -> (String, thread::JoinHandle<Vec<Vec<u8>>>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let worker = thread::spawn(move || {
        let mut requests = Vec::new();
        for (code, body) in responses {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "request never arrived");
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("{error}"),
                }
            };
            // macOS accepted sockets can inherit O_NONBLOCK from the listener.
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 8192];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(header_end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..header_end]);
                    let length: usize = headers
                        .lines()
                        .find_map(|l| {
                            l.to_lowercase()
                                .strip_prefix("content-length: ")
                                .map(|s| s.parse().unwrap())
                        })
                        .unwrap();
                    if bytes.len() >= header_end + 4 + length {
                        break;
                    }
                }
            }
            requests.push(bytes);
            write!(stream, "HTTP/1.1 {code} Result\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        }
        requests
    });
    (address, worker)
}

#[test]
fn transcription_sends_lossless_flac_and_retries_transient_errors() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("original.wav");
    let mut writer = hound::WavWriter::create(
        &path,
        hound::WavSpec {
            channels: 1,
            sample_rate: 48000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        },
    )
    .unwrap();
    let samples: Vec<i16> = (0..48000).map(|i| ((i % 500) - 250) as i16).collect();
    for &sample in &samples {
        writer.write_sample(sample).unwrap();
    }
    writer.finalize().unwrap();
    let original = fs::read(&path).unwrap();
    let (address, worker) = server(vec![
        (503, r#"{"error":"unavailable"}"#),
        (200, r#"{"text":"Recovered the complete recording."}"#),
    ]);
    let settings = Settings {
        api_base_url: address,
        api_key: "test-key".into(),
        language: "en".into(),
        ..Default::default()
    };
    let text = tauri::async_runtime::block_on(transcribe_audio(
        &reqwest::Client::new(),
        &settings,
        &[],
        &path,
        Arc::new(AtomicBool::new(false)),
        |part, total| assert_eq!((part, total), (1, 1)),
    ))
    .unwrap();
    assert_eq!(text, "Recovered the complete recording.");
    let requests = worker.join().unwrap();
    assert_eq!(requests.len(), 2);
    for request in requests {
        let text = String::from_utf8_lossy(&request);
        assert!(text.contains("filename=\"recording.flac\""));
        assert!(text.contains("audio/flac"));
        assert!(text.contains("name=\"language\"\r\n\r\nen"));
        let start = request.windows(4).position(|w| w == b"fLaC").unwrap();
        let end = start
            + request[start..]
                .windows(4)
                .position(|w| w == b"\r\n--")
                .unwrap();
        let decoded: Vec<i16> = claxon::FlacReader::new(std::io::Cursor::new(&request[start..end]))
            .unwrap()
            .samples()
            .map(|s| s.unwrap() as i16)
            .collect();
        assert_eq!(decoded, samples);
    }
    assert_eq!(fs::read(path).unwrap(), original);
}

#[test]
fn permanent_upload_error_is_actionable_and_original_can_be_reprocessed() {
    let dir = tempfile::tempdir().unwrap();
    let mut recording = recordings::create(dir.path(), "hold", None).unwrap();
    let path = recording.audio_path(dir.path());
    let writer = recordings::AudioWriter::start(
        &path,
        hound::WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        },
    )
    .unwrap();
    writer.input.write(vec![1400; 16000]);
    writer.finish().unwrap();
    recording.transcript = Some("Earlier successful transcript".into());
    recording.save(dir.path()).unwrap();
    let original = fs::read(&path).unwrap();
    let (address, worker) = server(vec![(413, r#"{"error":"Payload Too Large"}"#)]);
    let mut settings = Settings {
        api_base_url: address,
        api_key: "test-key".into(),
        ..Default::default()
    };
    let error = tauri::async_runtime::block_on(transcribe_audio(
        &reqwest::Client::new(),
        &settings,
        &[],
        &path,
        Arc::new(AtomicBool::new(false)),
        |_, _| {},
    ))
    .unwrap_err();
    assert_eq!(
        worker.join().unwrap().len(),
        1,
        "permanent errors must not loop"
    );
    assert_eq!(
        recording_failure_message(&error.to_string()),
        "Upload rejected as too large."
    );
    assert_eq!(fs::read(&path).unwrap(), original);
    assert_eq!(
        recordings::load(dir.path(), &recording.id)
            .unwrap()
            .transcript,
        recording.transcript
    );
    let (address, worker) = server(vec![(
        200,
        r#"{"text":"Reprocessed from the original audio."}"#,
    )]);
    settings.api_base_url = address;
    let text = tauri::async_runtime::block_on(transcribe_audio(
        &reqwest::Client::new(),
        &settings,
        &[],
        &path,
        Arc::new(AtomicBool::new(false)),
        |_, _| {},
    ))
    .unwrap();
    assert_eq!(text, "Reprocessed from the original audio.");
    assert_eq!(worker.join().unwrap().len(), 1);
    assert_eq!(fs::read(path).unwrap(), original);
}
