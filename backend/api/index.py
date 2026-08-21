import sys
from pathlib import Path

# Make the backend modules importable from the Vercel Python runtime.
# This file lives at <project-root>/api/index.py; main.py sits next to api/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import app  # noqa: E402
