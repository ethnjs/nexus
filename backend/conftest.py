import sys
import os

# Ensure the backend/ directory is on the path so `from app.x import y` works
# regardless of where pytest is invoked from.
sys.path.insert(0, os.path.dirname(__file__))