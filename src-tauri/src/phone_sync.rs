use std::{
    io::{self, Read, Write},
    net::{IpAddr, Ipv4Addr, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicU32, AtomicU8, Ordering::Relaxed},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use qrcode::{render::svg, QrCode};
use ring::{aead, hmac, rand};
use serde::Serialize;
use tauri::State;

use crate::AppState;

const LIFETIME: Duration = Duration::from_secs(120);
const POLL: Duration = Duration::from_millis(25);
const MAX_PAYLOAD: usize = 512 * 1024 - 28;
const WAITING: u8 = 0;
const SENT: u8 = 1;
const EXPIRED: u8 = 2;
static SEQUENCE: AtomicU32 = AtomicU32::new(1);

#[derive(Default)]
pub(crate) struct PhoneSync(Mutex<Option<Offer>>);

struct Offer {
    id: u32,
    state: Arc<AtomicU8>,
}

#[derive(Serialize)]
pub(crate) struct Pairing {
    id: u32,
    svg: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Profile<'a> {
    api_key: &'a str,
    base_url: &'a str,
    model: &'a str,
    vocabulary: &'a str,
}

#[tauri::command]
pub(crate) fn begin_phone_sync(
    app: State<'_, AppState>,
    pairing: State<'_, PhoneSync>,
) -> Result<Pairing, String> {
    let payload = {
        let settings = app.settings.lock().map_err(|_| "Settings unavailable.")?;
        if settings.api_key.trim().is_empty() {
            return Err("Save an API key first.".into());
        }
        let url = reqwest::Url::parse(&settings.api_base_url)
            .map_err(|_| "Set an HTTPS API URL first.")?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("Use an HTTPS API URL without credentials or query parameters.".into());
        }
        serde_json::to_vec(&Profile {
            api_key: settings.api_key.trim(),
            base_url: &settings.api_base_url,
            model: &settings.whisper_model,
            vocabulary: &settings.custom_vocabulary,
        })
        .map_err(|_| "Couldn’t prepare settings.")?
    };
    if payload.len() > MAX_PAYLOAD {
        return Err("Settings are too large to sync.".into());
    }

    let address = local_address().ok_or("Connect this Mac to the same network as your iPhone.")?;
    let listener =
        TcpListener::bind((address, 0)).map_err(|_| "Couldn’t open the local connection.")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "Couldn’t open the local connection.")?;
    let port = listener
        .local_addr()
        .map_err(|_| "Couldn’t open the local connection.")?
        .port();
    let seed = rand::generate::<[u8; 32]>(&rand::SystemRandom::new())
        .map_err(|_| "Couldn’t create a pairing code.")?
        .expose();

    let token = URL_SAFE_NO_PAD.encode(seed);
    let text = format!("verba-sync://{address}:{port}/v1/{token}");
    let svg = QrCode::new(text)
        .map_err(|_| "Couldn’t create a pairing code.")?
        .render::<svg::Color>()
        .min_dimensions(232, 232)
        .build();

    let id = SEQUENCE.fetch_add(1, Relaxed);
    let state = Arc::new(AtomicU8::new(WAITING));
    let mut current = pairing.0.lock().map_err(|_| "Couldn’t start sync.")?;
    if let Some(previous) = current.replace(Offer {
        id,
        state: state.clone(),
    }) {
        expire(&previous.state);
    }
    thread::spawn(move || serve(listener, seed, payload, state, LIFETIME));
    Ok(Pairing { id, svg })
}

#[tauri::command]
pub(crate) fn phone_sync_status(id: u32, pairing: State<'_, PhoneSync>) -> &'static str {
    match pairing.0.lock().ok().and_then(|current| {
        current
            .as_ref()
            .filter(|offer| offer.id == id)
            .map(|offer| offer.state.load(Relaxed))
    }) {
        Some(WAITING) => "waiting",
        Some(SENT) => "sent",
        _ => "expired",
    }
}

#[tauri::command]
pub(crate) fn cancel_phone_sync(id: u32, pairing: State<'_, PhoneSync>) {
    if let Ok(current) = pairing.0.lock() {
        if let Some(offer) = current.as_ref().filter(|offer| offer.id == id) {
            expire(&offer.state);
        }
    }
}

fn local_address() -> Option<Ipv4Addr> {
    let mut interfaces = if_addrs::get_if_addrs().ok()?;
    // Prefer physical interfaces on macOS when a VPN or bridge is also active.
    interfaces
        .sort_by_key(|interface| (!interface.name.starts_with("en"), interface.name != "en0"));
    interfaces
        .into_iter()
        .find_map(|interface| match interface.ip() {
            IpAddr::V4(address) if address.is_private() => Some(address),
            _ => None,
        })
}

fn expire(state: &AtomicU8) {
    let _ = state.compare_exchange(WAITING, EXPIRED, Relaxed, Relaxed);
}

fn serve(
    listener: TcpListener,
    seed: [u8; 32],
    payload: Vec<u8>,
    state: Arc<AtomicU8>,
    lifetime: Duration,
) {
    let deadline = Instant::now() + lifetime;
    while state.load(Relaxed) == WAITING && Instant::now() < deadline {
        match listener.accept() {
            Ok((connection, _)) => {
                if send_profile(connection, &seed, &payload, &state, deadline).is_ok() {
                    let _ = state.compare_exchange(WAITING, SENT, Relaxed, Relaxed);
                    return;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => thread::sleep(POLL),
            Err(_) => break,
        }
    }
    expire(&state);
}

fn send_profile(
    mut connection: TcpStream,
    seed: &[u8],
    profile: &[u8],
    state: &AtomicU8,
    expiry: Instant,
) -> Result<(), ()> {
    let random = rand::SystemRandom::new();
    let challenge = rand::generate::<[u8; 16]>(&random)
        .map_err(|_| ())?
        .expose();
    let nonce = rand::generate::<[u8; 12]>(&random)
        .map_err(|_| ())?
        .expose();
    connection.set_nonblocking(false).map_err(|_| ())?;
    connection
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|_| ())?;
    connection
        .set_read_timeout(Some(Duration::from_millis(100)))
        .map_err(|_| ())?;
    connection.write_all(&challenge).map_err(|_| ())?;

    let shared = hmac::Key::new(hmac::HMAC_SHA256, seed);
    let authentication = hmac::sign(&shared, b"verba-sync/auth/v1");
    let encryption = hmac::sign(&shared, b"verba-sync/key/v1");
    let auth_key = hmac::Key::new(hmac::HMAC_SHA256, authentication.as_ref());
    let mut proof = [0; 32];
    let mut offset = 0;
    let deadline = expiry.min(Instant::now() + Duration::from_secs(2));
    while offset < proof.len() && Instant::now() < deadline && state.load(Relaxed) == WAITING {
        match connection.read(&mut proof[offset..]) {
            Ok(0) => return Err(()),
            Ok(size) => offset += size,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
                ) => {}
            Err(_) => return Err(()),
        }
    }
    if offset != proof.len() || state.load(Relaxed) != WAITING || Instant::now() >= expiry {
        return Err(());
    }
    hmac::verify(&auth_key, &challenge, &proof).map_err(|_| ())?;

    let key = aead::UnboundKey::new(&aead::AES_256_GCM, encryption.as_ref()).map_err(|_| ())?;
    let mut sealed = profile.to_vec();
    aead::LessSafeKey::new(key)
        .seal_in_place_append_tag(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(challenge),
            &mut sealed,
        )
        .map_err(|_| ())?;
    let size = (nonce.len() + sealed.len()) as u32;
    connection.write_all(&size.to_be_bytes()).map_err(|_| ())?;
    connection.write_all(&nonce).map_err(|_| ())?;
    connection.write_all(&sealed).map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_scanner_with_the_pairing_secret_can_receive_settings_once() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let seed = [19; 32];
        let profile = b"test settings";
        let state = Arc::new(AtomicU8::new(WAITING));

        let worker = {
            let state = state.clone();
            thread::spawn(move || {
                serve(
                    listener,
                    seed,
                    profile.to_vec(),
                    state,
                    Duration::from_secs(3),
                )
            })
        };
        let connect = || {
            let stream = TcpStream::connect(address).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            stream
        };
        let mut unknown = connect();
        let mut challenge = [0; 16];
        unknown.read_exact(&mut challenge).unwrap();
        unknown.write_all(&[0; 32]).unwrap();
        assert_eq!(unknown.read(&mut [0; 1]).unwrap(), 0);
        assert_eq!(state.load(Relaxed), WAITING);

        let mut scanner = connect();
        scanner.read_exact(&mut challenge).unwrap();
        let seed_key = hmac::Key::new(hmac::HMAC_SHA256, &seed);
        let auth = hmac::sign(&seed_key, b"verba-sync/auth/v1");
        let proof = hmac::sign(
            &hmac::Key::new(hmac::HMAC_SHA256, auth.as_ref()),
            &challenge,
        );
        scanner.write_all(proof.as_ref()).unwrap();
        let mut length = [0; 4];
        scanner.read_exact(&mut length).unwrap();
        let mut frame = vec![0; u32::from_be_bytes(length) as usize];
        scanner.read_exact(&mut frame).unwrap();
        let (nonce, ciphertext) = frame.split_at_mut(12);
        let encryption = hmac::sign(&seed_key, b"verba-sync/key/v1");
        let key = aead::UnboundKey::new(&aead::AES_256_GCM, encryption.as_ref()).unwrap();
        let decrypted = aead::LessSafeKey::new(key)
            .open_in_place(
                aead::Nonce::try_assume_unique_for_key(nonce).unwrap(),
                aead::Aad::from(challenge),
                ciphertext,
            )
            .unwrap();
        assert_eq!(decrypted, profile);
        worker.join().unwrap();
        assert_eq!(state.load(Relaxed), SENT);
        assert!(TcpStream::connect(address).is_err());
    }
}
