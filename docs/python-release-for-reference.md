name: Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      skip_publish:
        description: 'Skip PyPI publish (for testing)'
        type: boolean
        default: false
      skip_release:
        description: 'Skip GitHub release (for testing)'
        type: boolean
        default: true
      tag:
        description: 'Tag for release (e.g. v1.0.8) - only needed for workflow_dispatch'
        type: string
        default: ''

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Install deps
        run: |
          pip install -e ".[dev]"
      - name: Run tests
        run: pytest -v

  build-linux:
    name: Build (Linux)
    needs: test
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Build package
        run: pip install build && python -m build

      - name: Install dependencies
        run: pip install rich click playwright gemini-webapi pyinstaller

      - name: Build executable
        run: |
          pythonPath=$(python -c "import site; print(site.getsitepackages()[0])")
          pyinstaller --onefile --name GemiTerm --add-data "src/gemiterm:gemiterm" --paths "$pythonPath" --hidden-import=rich --hidden-import=rich.console --hidden-import=rich.progress --hidden-import=rich.table --hidden-import=rich.panel --hidden-import=rich.markdown --hidden-import=rich.syntax --hidden-import=click --hidden-import=playwright --hidden-import=gemini_webapi --hidden-import=gemini_webapi_async src/gemiterm/__main__.py

      - name: Verify build
        run: |
          exeSize=$(stat -c%s dist/GemiTerm)
          exeSizeMB=$((exeSize / 1024 / 1024))
          echo "GemiTerm size: $exeSizeMB MB"
          if [ "$exeSizeMB" -lt 20 ]; then
            echo "ERROR: Exe is too small ($exeSizeMB MB). Dependencies may not be bundled."
            exit 1
          fi
          echo "Build verification passed"

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: GemiTerm
          path: dist/GemiTerm

  build-windows:
    name: Build (Windows)
    needs: test
    runs-on: windows-latest

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Build package
        run: pip install build && python -m build

      - name: Install dependencies
        run: pip install rich click playwright gemini-webapi pyinstaller

      - name: Build executable
        run: |
          $pythonPath = python -c "import site; print(site.getsitepackages()[0])"
          pyinstaller --onefile --name GemiTerm --add-data "src/gemiterm;gemiterm" --paths "$pythonPath" --hidden-import=rich --hidden-import=rich.console --hidden-import=rich.progress --hidden-import=rich.table --hidden-import=rich.panel --hidden-import=rich.markdown --hidden-import=rich.syntax --hidden-import=click --hidden-import=playwright --hidden-import=gemini_webapi --hidden-import=gemini_webapi_async src/gemiterm/__main__.py

      - name: Verify build
        run: |
          $exeSize = (Get-Item dist/GemiTerm.exe).Length / 1MB
          Write-Host "GemiTerm.exe size: $exeSize MB"
          if ($exeSize -lt 20) {
            Write-Host "ERROR: Exe is too small ($exeSize MB). Dependencies may not be bundled."
            exit 1
          }
          Write-Host "Build verification passed"

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: GemiTerm.exe
          path: dist/GemiTerm.exe

  publish:
    name: Publish to PyPI
    needs: [build-linux, build-windows]
    runs-on: ubuntu-latest
    if: ${{ !(github.event_name == 'workflow_dispatch' && inputs.skip_publish) }}
    permissions:
      id-token: write
      contents: read

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Build package
        run: pip install build && python -m build

      - name: Publish to PyPI
        uses: pypa/gh-action-pypi-publish@release/v1
        with:
          password: ${{ secrets.OIDC_PYPI_TOKEN }}

  release:
    name: Create Release
    needs: [build-linux, build-windows]
    runs-on: ubuntu-latest
    if: ${{ !(github.event_name == 'workflow_dispatch' && inputs.skip_release) }}
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - name: Download Linux binary
        uses: actions/download-artifact@v4
        with:
          name: GemiTerm
          path: dist

      - name: Download Windows binary
        uses: actions/download-artifact@v4
        with:
          name: GemiTerm.exe
          path: dist

      - name: Determine tag
        id: tag
        run: |
          if [ "${{ github.event_name }}" == "workflow_dispatch" ] && [ "${{ inputs.tag }}" != "" ]; then
            echo "tag=${{ inputs.tag }}" >> $GITHUB_OUTPUT
          else
            echo "tag=${{ github.ref_name }}" >> $GITHUB_OUTPUT
          fi

      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ steps.tag.outputs.tag }}
          files: dist/*
          generate_release_notes: true
