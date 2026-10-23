"""Compatibility entry point for the PDF exporter."""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parent / 'scripts' / 'export-pdf.py'), run_name='__main__')
