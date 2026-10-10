"""Describe here what the script does."""
import argparse
from pathlib import Path


def run(source: Path) -> None:
    # the work happens here
    print("Processing", source)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, nargs="?", default=Path("."), help="file or folder to process")
    args = parser.parse_args()
    run(args.source)


if __name__ == "__main__":
    main()
