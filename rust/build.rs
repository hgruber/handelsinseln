// Backt die Git-Beschreibung des Baustands ins Binary (Abstand zum letzten Tag).
// Ohne .git (Container, Tarball) bleibt GIT_DESCRIBE ungesetzt; main.rs nutzt dann APP_VERSION bzw. package.json.
use std::process::Command;

fn main() {
    // Neu auswerten, wenn sich der Git-Stand ändert (Commit, neues Tag).
    for p in ["../.git/HEAD", "../.git/packed-refs", "../.git/refs/tags"] {
        if std::path::Path::new(p).exists() {
            println!("cargo:rerun-if-changed={p}");
        }
    }
    println!("cargo:rerun-if-changed=build.rs");
    let out = Command::new("git")
        .args(["describe", "--tags", "--long", "--dirty"])
        .current_dir("..")
        .output();
    if let Ok(o) = out {
        if o.status.success() {
            let d = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if !d.is_empty() {
                println!("cargo:rustc-env=GIT_DESCRIBE={d}");
            }
        }
    }
}
