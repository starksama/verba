//! Prepare bounded, lossless uploads without modifying the durable recording.
use flacenc::{component::BitRepr, error::Verify};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

// Leave room for multipart fields and providers that interpret MB as decimal.
pub const MAX_UPLOAD_BYTES: usize = 24_000_000;
// Bound encoder memory independently of the recording's total duration.
const MAX_INPUT_SAMPLES: usize = 16_000_000;
const MAX_PART_SECONDS: usize = 600;

pub struct PreparedAudio {
    pub parts: Vec<PathBuf>,
    _directory: tempfile::TempDir,
}

pub fn prepare(path: &Path, cancelled: &AtomicBool) -> Result<PreparedAudio, String> {
    prepare_with_limits(path, cancelled, MAX_UPLOAD_BYTES, MAX_INPUT_SAMPLES)
}

fn prepare_with_limits(
    path: &Path,
    cancelled: &AtomicBool,
    max_bytes: usize,
    max_samples: usize,
) -> Result<PreparedAudio, String> {
    let mut reader = hound::WavReader::open(path).map_err(|e| e.to_string())?;
    let spec = reader.spec();
    if spec.sample_format != hound::SampleFormat::Int
        || spec.bits_per_sample != 16
        || !(1..=8).contains(&spec.channels)
        || spec.sample_rate == 0
    {
        return Err("Unsupported recording format. Original audio is saved in History.".into());
    }
    let channels = usize::from(spec.channels);
    let total_frames = reader.duration() as usize;
    if total_frames == 0 {
        return Err("No microphone audio was captured.".into());
    }
    let max_frames = (max_samples / channels)
        .min(spec.sample_rate as usize * MAX_PART_SECONDS)
        .max(1);
    let directory = tempfile::Builder::new()
        .prefix("verba-upload-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let mut result = PreparedAudio {
        parts: Vec::new(),
        _directory: directory,
    };
    let mut frame = 0;
    while frame < total_frames {
        check_cancelled(cancelled)?;
        let count = (total_frames - frame).min(max_frames);
        reader.seek(frame as u32).map_err(|e| e.to_string())?;
        let mut samples = reader
            .samples::<i16>()
            .take(count * channels)
            .map(|s| s.map(i32::from))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if samples.len() != count * channels {
            return Err("Recording ended unexpectedly. Original audio is saved in History.".into());
        }
        // Prefer a quiet boundary for long recordings; every frame still belongs
        // to exactly one part, including the final sub-second tail.
        let used_frames = if frame + count < total_frames {
            quiet_boundary(&samples, spec, count)
        } else {
            count
        };
        samples.truncate(used_frames * channels);
        encode_parts(&samples, spec, max_bytes, cancelled, &mut result)?;
        frame += used_frames;
    }
    Ok(result)
}

fn check_cancelled(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::SeqCst) {
        Err("Interrupted".into())
    } else {
        Ok(())
    }
}

// Look up to five seconds before the desired cut for the quietest 20 ms window.
fn quiet_boundary(samples: &[i32], spec: hound::WavSpec, desired: usize) -> usize {
    let channels = usize::from(spec.channels);
    let window = (spec.sample_rate as usize / 50).max(1);
    let start = desired
        .saturating_sub(spec.sample_rate as usize * 5)
        .max(desired / 2);
    if start + window >= desired {
        return desired;
    }
    let mut best = desired;
    let mut quietest = u64::MAX;
    for frame in (start..=desired - window).step_by(window) {
        let energy = samples[frame * channels..(frame + window) * channels]
            .iter()
            .map(|&s| (i64::from(s) * i64::from(s)) as u64)
            .sum::<u64>();
        if energy <= quietest {
            quietest = energy;
            best = frame + window / 2;
        }
    }
    best.max(1)
}

fn encode_parts(
    samples: &[i32],
    spec: hound::WavSpec,
    max_bytes: usize,
    cancelled: &AtomicBool,
    result: &mut PreparedAudio,
) -> Result<(), String> {
    check_cancelled(cancelled)?;
    let config = flacenc::config::Encoder::default()
        .into_verified()
        .map_err(|e| format!("Audio encoder configuration failed: {e:?}"))?;
    let source = flacenc::source::MemSource::from_samples(
        samples,
        spec.channels as usize,
        16,
        spec.sample_rate as usize,
    );
    let stream = flacenc::encode_with_fixed_block_size(&config, source, config.block_size)
        .map_err(|e| format!("Audio compression failed: {e}"))?;
    let mut sink = flacenc::bitsink::ByteSink::new();
    stream
        .write(&mut sink)
        .map_err(|e| format!("Audio compression failed: {e}"))?;
    check_cancelled(cancelled)?;
    if sink.as_slice().len() > max_bytes {
        // Noise may compress poorly. Size is verified, never assumed from duration.
        let frames = samples.len() / spec.channels as usize;
        if frames < 2 {
            return Err("Audio upload limit is too small.".into());
        }
        let cut = quiet_boundary(samples, spec, frames / 2) * spec.channels as usize;
        drop(sink);
        drop(stream);
        encode_parts(&samples[..cut], spec, max_bytes, cancelled, result)?;
        return encode_parts(&samples[cut..], spec, max_bytes, cancelled, result);
    }
    let path = result
        ._directory
        .path()
        .join(format!("part-{}.flac", result.parts.len()));
    fs::write(&path, sink.as_slice()).map_err(|e| e.to_string())?;
    result.parts.push(path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(path: &Path, channels: u16, samples: &[i16]) {
        let mut writer = hound::WavWriter::create(
            path,
            hound::WavSpec {
                channels,
                sample_rate: 48000,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )
        .unwrap();
        for &s in samples {
            writer.write_sample(s).unwrap();
        }
        writer.finalize().unwrap();
    }

    fn decode(prepared: &PreparedAudio) -> Vec<i16> {
        prepared
            .parts
            .iter()
            .flat_map(|p| {
                claxon::FlacReader::open(p)
                    .unwrap()
                    .samples()
                    .map(|s| s.unwrap() as i16)
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    #[test]
    fn flac_roundtrip_preserves_every_sample_and_original() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("original.wav");
        let samples: Vec<i16> = (0..48001)
            .flat_map(|i| [i as i16, -(i as i16).saturating_abs()])
            .collect();
        wav(&path, 2, &samples);
        let original = fs::read(&path).unwrap();
        let prepared = prepare(&path, &AtomicBool::new(false)).unwrap();
        assert_eq!(prepared.parts.len(), 1);
        assert_eq!(decode(&prepared), samples);
        assert_eq!(fs::read(&path).unwrap(), original);
        let info = claxon::FlacReader::open(&prepared.parts[0])
            .unwrap()
            .streaminfo();
        assert_eq!(
            (info.channels, info.sample_rate, info.bits_per_sample),
            (2, 48000, 16)
        );
        let temporary = prepared.parts[0].clone();
        drop(prepared);
        assert!(!temporary.exists());
        assert!(path.exists());
    }

    #[test]
    fn incompressible_audio_splits_under_limit_without_missing_or_duplicating_frames() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("noise.wav");
        let mut seed = 17_u32;
        let samples: Vec<i16> = (0..96003)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                (seed >> 16) as i16
            })
            .collect();
        wav(&path, 3, &samples);
        let prepared = prepare_with_limits(&path, &AtomicBool::new(false), 12000, 48000).unwrap();
        assert!(prepared.parts.len() > 2);
        for path in &prepared.parts {
            assert!(fs::metadata(path).unwrap().len() <= 12000);
        }
        assert_eq!(decode(&prepared), samples);
    }

    #[test]
    fn cancellation_and_empty_recordings_leave_original_intact() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("original.wav");
        wav(&path, 1, &[12; 4800]);
        let bytes = fs::read(&path).unwrap();
        assert!(prepare(&path, &AtomicBool::new(true)).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        wav(&path, 1, &[]);
        assert!(prepare(&path, &AtomicBool::new(false)).is_err());
        assert!(path.exists());
    }

    #[test]
    #[ignore = "Local recording verification; requires VERBA_VERIFY_AUDIO"]
    fn verify_saved_recording() {
        let path = PathBuf::from(std::env::var_os("VERBA_VERIFY_AUDIO").expect("recording path"));
        let prepared = prepare(&path, &AtomicBool::new(false)).unwrap();
        let source: Vec<i16> = hound::WavReader::open(&path)
            .unwrap()
            .into_samples::<i16>()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(decode(&prepared), source);
        let bytes: u64 = prepared
            .parts
            .iter()
            .map(|p| fs::metadata(p).unwrap().len())
            .sum();
        println!(
            "Verified {} samples, {} FLAC parts, {} upload bytes",
            source.len(),
            prepared.parts.len(),
            bytes
        );
    }
}
