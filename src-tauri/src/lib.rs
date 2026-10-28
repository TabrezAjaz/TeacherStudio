use serde::Serialize;
use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const MAX_SOURCE: u64 = 75 * 1024 * 1024;
const MAX_EXPORT: usize = 200 * 1024 * 1024;

#[tauri::command]
async fn save_export(bytes: Vec<u8>, name: String, extension: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || save_export_blocking(bytes, name, extension))
        .await
        .map_err(|error| error.to_string())?
}

fn save_export_blocking(bytes: Vec<u8>, name: String, extension: String) -> Result<bool, String> {
    if bytes.is_empty() || bytes.len() > MAX_EXPORT {
        return Err("Export is empty or exceeds 200 MB.".into());
    }
    if !["pdf", "png", "teacherstudio"].contains(&extension.as_str()) {
        return Err("Unsupported export format.".into());
    }
    let path = match rfd::FileDialog::new()
        .set_title("Export a copy — Teacher Studio")
        .set_file_name(&name)
        .add_filter("Teacher Studio export", &[&extension])
        .save_file()
    {
        Some(path) => path,
        None => return Ok(false),
    };
    let parent = path.parent().ok_or("Invalid destination folder.")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("Cannot create destination file: {e}"))?;
    temporary.write_all(&bytes).map_err(|e| format!("Export write failed: {e}"))?;
    temporary.as_file().sync_all().map_err(|e| format!("Export sync failed: {e}"))?;
    temporary.persist(&path).map_err(|e| format!("Cannot finish export; previous destination was not intentionally removed: {e}"))?;
    Ok(true)
}

#[derive(Serialize)]
struct Converted {
    name: String,
    bytes: Vec<u8>,
}

#[tauri::command]
async fn convert_presentation() -> Result<Option<Converted>, String> {
    tauri::async_runtime::spawn_blocking(convert_blocking)
        .await
        .map_err(|error| error.to_string())?
}

fn convert_blocking() -> Result<Option<Converted>, String> {
    let source = match rfd::FileDialog::new()
        .set_title("Import PowerPoint — requires local LibreOffice")
        .add_filter("PowerPoint", &["ppt", "pptx"])
        .pick_file()
    {
        Some(path) => path,
        None => return Ok(None),
    };
    let extension = source.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["ppt", "pptx"].contains(&extension.as_str()) {
        return Err("Please select a PPT or PPTX file.".into());
    }
    let metadata = fs::metadata(&source).map_err(|e| format!("Cannot read presentation: {e}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_SOURCE {
        return Err("Presentation must be a nonempty file smaller than 75 MB.".into());
    }
    let office = ["ProgramFiles", "ProgramFiles(x86)"].iter()
        .filter_map(std::env::var_os)
        .map(|root| PathBuf::from(root).join("LibreOffice").join("program").join("soffice.exe"))
        .find(|path| path.is_file())
        .ok_or("LibreOffice was not found. Install LibreOffice locally, or export the presentation to PDF in PowerPoint and open the PDF here.")?;
    let temporary = tempfile::tempdir().map_err(|e| format!("Cannot create conversion directory: {e}"))?;
    let input = temporary.path().join(format!("slides.{extension}"));
    fs::copy(&source, &input).map_err(|e| format!("Cannot stage presentation: {e}"))?;
    let profile = temporary.path().join("profile");
    let profile_uri = url::Url::from_directory_path(&profile)
        .map_err(|_| "Cannot construct a local conversion profile URL.")?;
    let mut command = Command::new(office);
    command.args(["--headless", "--nologo", "--nodefault", "--nofirststartwizard"])
        .arg(format!("-env:UserInstallation={profile_uri}"))
        .args(["--convert-to", "pdf:impress_pdf_Export", "--outdir"])
        .arg(temporary.path()).arg(&input)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| format!("Cannot start LibreOffice: {e}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait().map_err(|e| format!("Cannot monitor conversion: {e}"))? {
            Some(status) if status.success() => break,
            Some(status) => return Err(format!("LibreOffice conversion failed ({status}). Try exporting to PDF in PowerPoint.")),
            None if started.elapsed() > Duration::from_secs(90) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Conversion timed out after 90 seconds. Try exporting to PDF in PowerPoint.".into());
            }
            None => thread::sleep(Duration::from_millis(150)),
        }
    }
    let output = temporary.path().join("slides.pdf");
    let size = fs::metadata(&output).map_err(|e| format!("LibreOffice produced no PDF: {e}"))?.len();
    if size == 0 || size > MAX_SOURCE {
        return Err("Converted PDF is empty or exceeds 75 MB.".into());
    }
    let bytes = fs::read(output).map_err(|e| format!("Cannot read converted PDF: {e}"))?;
    if !bytes.starts_with(b"%PDF-") {
        return Err("Converter output was not a PDF.".into());
    }
    let name = format!("{}.pdf", source.file_stem().and_then(|s| s.to_str()).unwrap_or("Presentation"));
    Ok(Some(Converted { name, bytes }))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_export, convert_presentation])
        .run(tauri::generate_context!())
        .expect("Teacher Studio failed to start");
}
