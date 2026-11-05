//! Audio is durable independently of the UI and transcription pipeline.
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, BufWriter, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Recording {
    #[serde(default)]
    pub id: String,
    pub created_at_ms: u64,
    pub recording_mode: String,
    pub source_app: Option<String>,
    pub status: String,
    pub error: Option<String>,
    #[serde(default)]
    pub transcript: Option<String>,
    #[serde(default)]
    pub raw_transcript: Option<String>,
}

impl Recording {
    pub fn audio_path(&self, dir: &Path) -> PathBuf {
        dir.join(format!("{}.wav", self.id))
    }
    pub fn save(&self, dir: &Path) -> io::Result<()> {
        let path = dir.join(format!("{}.json", self.id));
        if let Ok(bytes) = fs::read(&path) {
            if serde_json::from_slice::<Recording>(&bytes).is_err() {
                let backup = path.with_extension("json.recovery-backup");
                if !backup.exists() {
                    atomic_write(&backup, &bytes)?;
                }
            }
        }
        atomic_write(&path, &serde_json::to_vec_pretty(self)?)
    }
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let temporary = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        if let Some(parent) = path.parent() {
            File::open(parent)?.sync_all()?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

pub fn create(dir: &Path, mode: &str, source: Option<String>) -> io::Result<Recording> {
    fs::create_dir_all(dir)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let recording = Recording {
        id: format!(
            "recording-{now}-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ),
        created_at_ms: now,
        recording_mode: mode.to_owned(),
        source_app: source,
        status: "recording".into(),
        error: None,
        transcript: None,
        raw_transcript: None,
    };
    recording.save(dir)?;
    Ok(recording)
}

pub fn load(dir: &Path, id: &str) -> io::Result<Recording> {
    if !id.starts_with("recording-")
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || b == b'-' || b.is_ascii_lowercase())
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid recording ID",
        ));
    }
    let audio = dir.join(format!("{id}.wav"));
    if !fs::symlink_metadata(&audio)?.file_type().is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid recording file",
        ));
    }
    let mut recording: Recording = fs::read(dir.join(format!("{id}.json")))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(|| Recording {
            id: id.into(),
            created_at_ms: id
                .split('-')
                .nth(1)
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
            recording_mode: "hold".into(),
            source_app: None,
            status: "recovered".into(),
            error: None,
            transcript: None,
            raw_transcript: None,
        });
    recording.id = id.to_owned();
    Ok(recording)
}

pub fn list(dir: &Path) -> io::Result<Vec<Recording>> {
    fs::create_dir_all(dir)?;
    let mut result = Vec::new();
    for item in fs::read_dir(dir)? {
        let item = item?;
        if !item.file_type()?.is_file()
            || item.path().extension().and_then(|s| s.to_str()) != Some("wav")
        {
            continue;
        }
        let id = item
            .path()
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        if let Ok(recording) = load(dir, &id) {
            result.push(recording);
        }
    }
    result.sort_by_key(|recording| std::cmp::Reverse(recording.created_at_ms));
    Ok(result)
}

/// Repair a stale RIFF length after an unclean exit, preserving every complete PCM frame.
/// The data chunk must be last (as written by our PCM16 writer).
pub fn repair_wav(path: &Path) -> io::Result<()> {
    let mut file = OpenOptions::new().read(true).write(true).open(path)?;
    let length = file.metadata()?.len();
    let mut header = [0; 12];
    file.read_exact(&mut header)?;
    if &header[..4] != b"RIFF" || &header[8..] != b"WAVE" {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid WAV header",
        ));
    }
    let mut block_align = 0_u16;
    loop {
        let mut chunk = [0; 8];
        file.read_exact(&mut chunk)?;
        let size = u32::from_le_bytes(chunk[4..8].try_into().unwrap()) as u64;
        let start = file.stream_position()?;
        if &chunk[..4] == b"fmt " {
            if size < 16 || start + size > length {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Invalid WAV format",
                ));
            }
            let mut fmt = [0; 16];
            file.read_exact(&mut fmt)?;
            let format = u16::from_le_bytes([fmt[0], fmt[1]]);
            let mut is_pcm = format == 1;
            if format == 0xfffe && size >= 40 {
                // Hound uses WAVE_FORMAT_EXTENSIBLE for microphones with >2 channels.
                let mut extension = [0; 24];
                file.read_exact(&mut extension)?;
                let pcm_guid = [1, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113];
                is_pcm = u16::from_le_bytes([extension[0], extension[1]]) >= 22
                    && extension[8..] == pcm_guid;
            }
            if !is_pcm {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Recovery requires PCM audio",
                ));
            }
            block_align = u16::from_le_bytes([fmt[12], fmt[13]]);
        } else if &chunk[..4] == b"data" {
            if block_align == 0 || start > length || length > u32::MAX as u64 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Invalid WAV size",
                ));
            }
            let data_length = (length - start) / block_align as u64 * block_align as u64;
            file.seek(SeekFrom::Start(start - 4))?;
            file.write_all(&(data_length as u32).to_le_bytes())?;
            file.seek(SeekFrom::Start(4))?;
            file.write_all(&((start + data_length - 8) as u32).to_le_bytes())?;
            return file.sync_all();
        }
        let next = start
            .checked_add(size + size % 2)
            .filter(|next| *next <= length)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Invalid WAV chunk"))?;
        file.seek(SeekFrom::Start(next))?;
    }
}

pub fn recover(dir: &Path) -> io::Result<usize> {
    let mut count = 0;
    for mut recording in list(dir)? {
        if matches!(
            recording.status.as_str(),
            "recording" | "processing" | "interrupted" | "recovered" | "transcribed"
        ) {
            recording.error = repair_wav(&recording.audio_path(dir))
                .err()
                .map(|e| e.to_string());
            recording.status = if recording.error.is_some() {
                "failed"
            } else {
                "saved"
            }
            .into();
            recording.save(dir)?;
            count += 1;
        }
    }
    Ok(count)
}

#[derive(Clone)]
pub struct AudioInput {
    sender: mpsc::Sender<Vec<i16>>,
    pub error: Arc<Mutex<Option<String>>>,
    pub reported: Arc<AtomicBool>,
}
impl AudioInput {
    pub fn write(&self, samples: Vec<i16>) {
        if self.sender.send(samples).is_err() {
            if let Ok(mut error) = self.error.lock() {
                error.get_or_insert_with(|| "Audio storage stopped".into());
            }
        }
    }
}

pub struct AudioWriter {
    pub input: AudioInput,
    worker: thread::JoinHandle<Result<(), String>>,
}
impl AudioWriter {
    pub fn start(path: &Path, spec: hound::WavSpec) -> Result<Self, String> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        let durable = file.try_clone().map_err(|e| e.to_string())?;
        let mut writer =
            hound::WavWriter::new(BufWriter::new(file), spec).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        durable.sync_all().map_err(|e| e.to_string())?;
        File::open(path.parent().unwrap())
            .and_then(|dir| dir.sync_all())
            .map_err(|e| e.to_string())?;
        let (sender, receiver) = mpsc::channel::<Vec<i16>>();
        let error = Arc::new(Mutex::new(None));
        let worker_error = error.clone();
        let worker = thread::spawn(move || {
            let result = (|| -> Result<(), String> {
                for samples in receiver {
                    for sample in samples {
                        writer.write_sample(sample).map_err(|e| e.to_string())?;
                    }
                    // Each delivered buffer is a readable, durable WAV checkpoint.
                    writer.flush().map_err(|e| e.to_string())?;
                    durable.sync_data().map_err(|e| e.to_string())?;
                }
                writer.finalize().map_err(|e| e.to_string())?;
                durable.sync_all().map_err(|e| e.to_string())
            })();
            if let Err(message) = &result {
                if let Ok(mut error) = worker_error.lock() {
                    *error = Some(message.clone());
                }
            }
            result
        });
        Ok(Self {
            input: AudioInput {
                sender,
                error,
                reported: Arc::new(AtomicBool::new(false)),
            },
            worker,
        })
    }
    pub fn finish(self) -> Result<(), String> {
        drop(self.input);
        self.worker
            .join()
            .map_err(|_| "Audio writer stopped unexpectedly".to_string())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn dir() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "verba-storage-test-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }
    fn spec() -> hound::WavSpec {
        hound::WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        }
    }
    #[test]
    fn finish_drains_every_queued_buffer_and_preserves_short_recordings() {
        let d = dir();
        let r = create(&d, "hold", None).unwrap();
        let writer = AudioWriter::start(&r.audio_path(&d), spec()).unwrap();
        for _ in 0..20 {
            writer.input.write(vec![400; 32]);
        }
        writer.finish().unwrap();
        let samples = hound::WavReader::open(r.audio_path(&d))
            .unwrap()
            .into_samples::<i16>()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(samples, vec![400; 640]);
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn repairs_samples_written_after_last_header_checkpoint() {
        let d = dir();
        let r = create(&d, "hold", None).unwrap();
        let writer = AudioWriter::start(&r.audio_path(&d), spec()).unwrap();
        writer.finish().unwrap();
        let mut file = OpenOptions::new()
            .append(true)
            .open(r.audio_path(&d))
            .unwrap();
        for _ in 0..128 {
            file.write_all(&1200_i16.to_le_bytes()).unwrap();
        }
        drop(file);
        assert_eq!(recover(&d).unwrap(), 1);
        assert_eq!(
            hound::WavReader::open(r.audio_path(&d)).unwrap().duration(),
            128
        );
        assert_eq!(load(&d, &r.id).unwrap().status, "saved");
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn discard_and_transcript_updates_never_remove_audio() {
        let d = dir();
        let mut r = create(&d, "toggle", None).unwrap();
        let writer = AudioWriter::start(&r.audio_path(&d), spec()).unwrap();
        writer.input.write(vec![1; 160]);
        writer.finish().unwrap();
        for status in [
            "interrupted",
            "discarded",
            "saved",
            "processing",
            "completed",
        ] {
            r.status = status.into();
            r.transcript = Some("Retained text".into());
            r.save(&d).unwrap();
            assert!(r.audio_path(&d).exists());
        }
        assert_eq!(
            load(&d, &r.id).unwrap().transcript.as_deref(),
            Some("Retained text")
        );
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn recovers_stereo_and_multichannel_microphone_formats() {
        let d = dir();
        for channels in [2, 4] {
            let r = create(&d, "hold", None).unwrap();
            let writer =
                AudioWriter::start(&r.audio_path(&d), hound::WavSpec { channels, ..spec() })
                    .unwrap();
            writer.input.write(vec![400; 320 * channels as usize]);
            writer.finish().unwrap();
            repair_wav(&r.audio_path(&d)).unwrap();
            let reader = hound::WavReader::open(r.audio_path(&d)).unwrap();
            assert_eq!(reader.spec().channels, channels);
            assert_eq!(reader.duration(), 320);
            assert_eq!(
                reader
                    .into_samples::<i16>()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap(),
                vec![400; 320 * channels as usize]
            );
        }
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn recovers_orphan_corrupt_and_inflight_audio_without_touching_completed() {
        let d = dir();
        let mut ids = Vec::new();
        for status in [
            "orphan",
            "corrupt",
            "processing",
            "interrupted",
            "transcribed",
            "completed",
            "discarded",
        ] {
            let mut r = create(&d, "toggle", None).unwrap();
            let writer = AudioWriter::start(&r.audio_path(&d), spec()).unwrap();
            writer.input.write(vec![234; 320]);
            writer.finish().unwrap();
            r.status = status.into();
            r.transcript = Some("Text survives recovery".into());
            r.save(&d).unwrap();
            let metadata = d.join(format!("{}.json", r.id));
            if status == "orphan" {
                fs::remove_file(metadata).unwrap();
            } else if status == "corrupt" {
                fs::write(metadata, b"incomplete metadata").unwrap();
            }
            ids.push((r.id, status));
        }
        assert_eq!(list(&d).unwrap().len(), 7);
        assert_eq!(recover(&d).unwrap(), 5);
        assert_eq!(recover(&d).unwrap(), 0);
        for (id, previous) in ids {
            let r = load(&d, &id).unwrap();
            assert_eq!(
                hound::WavReader::open(r.audio_path(&d)).unwrap().duration(),
                320
            );
            assert_eq!(
                r.status,
                if ["completed", "discarded"].contains(&previous) {
                    previous
                } else {
                    "saved"
                }
            );
            if !["orphan", "corrupt"].contains(&previous) {
                assert_eq!(r.transcript.as_deref(), Some("Text survives recovery"));
            }
            if previous == "corrupt" {
                assert_eq!(
                    fs::read(d.join(format!("{id}.json.recovery-backup"))).unwrap(),
                    b"incomplete metadata"
                );
            }
        }
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn invalid_audio_remains_visible_and_is_never_removed_by_recovery() {
        let d = dir();
        let r = create(&d, "hold", None).unwrap();
        fs::write(r.audio_path(&d), b"partial header").unwrap();
        recover(&d).unwrap();
        let recovered = load(&d, &r.id).unwrap();
        assert_eq!(recovered.status, "failed");
        assert!(recovered.error.is_some());
        assert_eq!(fs::read(r.audio_path(&d)).unwrap(), b"partial header");
        fs::remove_dir_all(d).unwrap();
    }
    // Run a real writer in another process, then kill it without finalize().
    #[test]
    fn crash_writer_child() {
        let Ok(path) = std::env::var("VERBA_TEST_CRASH_DIR") else {
            return;
        };
        let d = PathBuf::from(path);
        let r = create(&d, "hold", None).unwrap();
        let writer = AudioWriter::start(&r.audio_path(&d), spec()).unwrap();
        writer.input.write(vec![1200; 1600]);
        loop {
            thread::sleep(std::time::Duration::from_millis(20));
        }
    }
    #[test]
    fn recovers_checkpoint_after_forced_process_termination() {
        let d = dir();
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "recordings::tests::crash_writer_child"])
            .env("VERBA_TEST_CRASH_DIR", &d)
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut checkpoint = false;
        while std::time::Instant::now() < deadline {
            checkpoint = list(&d).unwrap().iter().any(|r| {
                hound::WavReader::open(r.audio_path(&d))
                    .map(|w| w.duration() == 1600)
                    .unwrap_or(false)
            });
            if checkpoint {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(10));
        }
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(
            checkpoint,
            "Writer must expose a complete WAV before it exits"
        );
        assert_eq!(recover(&d).unwrap(), 1);
        let r = list(&d).unwrap().remove(0);
        assert_eq!(r.status, "saved");
        assert_eq!(
            hound::WavReader::open(r.audio_path(&d))
                .unwrap()
                .into_samples::<i16>()
                .collect::<Result<Vec<_>, _>>()
                .unwrap(),
            vec![1200; 1600]
        );
        fs::remove_dir_all(d).unwrap();
    }
    #[test]
    fn rejects_recording_path_traversal() {
        let d = dir();
        assert!(load(&d, "../../settings").is_err());
        fs::remove_dir_all(d).unwrap();
    }
}
