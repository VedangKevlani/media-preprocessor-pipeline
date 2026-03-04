import sys
from pathlib import Path

from slides import make_transparent, process_image


def process_png(input_path: str, logo_path: str, output_path: str) -> None:
  """
  Processes a single PNG image:
  - removes the NotebookLM watermark region
  - overlays the provided logo
  - writes the result to output_path (PNG)
  """
  input_file = Path(input_path)
  logo_file = Path(logo_path)
  output_file = Path(output_path)

  if not input_file.is_file():
    raise FileNotFoundError(f"Input image not found: {input_file}")
  if not logo_file.is_file():
    raise FileNotFoundError(f"Logo image not found: {logo_file}")

  logo_buf = make_transparent(str(logo_file))
  data = input_file.read_bytes()
  out_bytes = process_image(data, logo_buf)
  output_file.write_bytes(out_bytes)


if __name__ == "__main__":
  if len(sys.argv) != 4:
    print("Usage: python image_pipeline.py input.png logo.png output.png")
    sys.exit(1)

  process_png(sys.argv[1], sys.argv[2], sys.argv[3])
