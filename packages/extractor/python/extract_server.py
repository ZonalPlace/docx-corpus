#!/usr/bin/env python3
"""Persistent DocX extraction server using Docling.

Reads file paths from stdin (one per line), outputs JSON per line to stdout.
This avoids the overhead of spawning a new Python process for each document.
"""
import json
import sys
from pathlib import Path

from docling.document_converter import DocumentConverter
from docling.datamodel.base_models import InputFormat


def strip_image_data(extraction: dict) -> dict:
    """Remove base64 image data from extraction to reduce size."""
    if "pictures" in extraction:
        extraction["pictures"] = [
            {k: v for k, v in pic.items() if k != "image"}
            for pic in extraction["pictures"]
        ]
    return extraction


def extract(converter: DocumentConverter, file_path: str) -> dict:
    """Extract text and structure from a DOCX file using Docling."""
    result = converter.convert(file_path)

    # Export as markdown for text extraction
    text = result.document.export_to_markdown()

    # Get full structured extraction (stripped of image data)
    extraction = result.document.export_to_dict()
    extraction = strip_image_data(extraction)

    return {
        "text": text,
        "wordCount": len(text.split()),
        "charCount": len(text),
        "tableCount": len(extraction.get("tables", [])),
        "imageCount": len(extraction.get("pictures", [])),
        "extraction": extraction,
    }


def main():
    # Signal that we're ready (after imports complete)
    print(json.dumps({"ready": True}), flush=True)

    # Initialize converter ONCE (restricted to DOCX only to avoid loading PDF models)
    converter = DocumentConverter(allowed_formats=[InputFormat.DOCX])

    # Signal that converter is initialized
    print(json.dumps({"initialized": True}), flush=True)

    # Read file paths from stdin, output JSON per line
    for line in sys.stdin:
        file_path = line.strip()
        if not file_path:
            continue

        try:
            if not Path(file_path).exists():
                print(json.dumps({"success": False, "error": f"File not found: {file_path}"}), flush=True)
                continue

            result = extract(converter, file_path)
            print(json.dumps({"success": True, **result}), flush=True)

        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
