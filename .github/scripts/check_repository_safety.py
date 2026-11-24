"""Check tracked filenames and PR routing without reading or printing secret values."""
import os
from pathlib import PurePosixPath
import subprocess
import sys


def private_file(path: str) -> bool:
    name = PurePosixPath(path).name.lower()
    if name == ".env" or name.startswith(".env."):
        return not name.endswith((".example", ".sample", ".template"))
    return name in {"id_rsa", "id_ed25519", "id_ecdsa"} or name.endswith((".pem", ".key", ".p12", ".pfx"))


def main() -> int:
    paths = subprocess.check_output(["git", "ls-files", "-z"]).decode("utf-8").split("\0")
    blocked = [path for path in paths if path and private_file(path)]
    if blocked:
        print("Private environment/key files must not be tracked:")
        for path in blocked:
            print(f"  {path!r}")
    wrong_target = os.environ.get("PR_HEAD", "").startswith("feature/") and os.environ.get("PR_BASE") == "main"
    if wrong_target:
        print("Feature PRs must target Dev. Promote Dev to main after review.")
    if blocked or wrong_target:
        return 1
    print("Repository safety checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
