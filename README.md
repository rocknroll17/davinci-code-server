# Da Vinci Code — Game Server

[![CI](https://github.com/rocknroll17/davinci-code-server/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rocknroll17/davinci-code-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Play the board game Da Vinci Code against a trained AI.
The model is trained in [davinci-code-agent](https://github.com/rocknroll17/davinci-code-agent).

**[Play in your browser →](https://davinci-code.rocknroll17.com/)**

This repository serves the game in two ways.

## Browser demo

`docs/` is a static page: the game rules are in JavaScript and the model runs in the
browser with ONNX Runtime Web. There is no backend. It is published with GitHub Pages.

To update the model:

```bash
python scripts/export_onnx.py <checkpoint.pt> docs/model.onnx --int8
```

## Server

A FastAPI server with vs-AI and player-vs-player games; events are pushed over SSE.

```bash
docker run -d --gpus all -p 6000:6000 ghcr.io/rocknroll17/davinci-code-server:latest
```

Open `http://localhost:6000`. The image includes the model; drop `--gpus all` to run on CPU.

To run from source (Python 3.10):

```bash
pip install -r requirements.txt
oras pull ghcr.io/rocknroll17/davinci-model:latest -o checkpoints
python run.py
```

API reference: `http://localhost:6000/docs`. Settings (`PORT`, `CHECKPOINT_PATH`, ...) are in
[`app/core/config.py`](app/core/config.py).

## License

[MIT](LICENSE)
