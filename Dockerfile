# Da Vinci Code — Game Server (FastAPI + uvicorn)
# README 기준 Python 3.10
FROM python:3.10-slim

WORKDIR /app

# 의존성 먼저 복사 → 레이어 캐시 활용.
# torch>=2.9.0 기본 휠 = CUDA 빌드. `docker run --gpus all`로 GPU 추론,
# 플래그 없이 실행하면 CPU로 자동 폴백(torch.cuda.is_available()).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 + 모델 복사.
# model.pt는 git이 아니라 GHCR OCI 아티팩트(ghcr.io/<owner>/davinci-model)에서
# 빌드 직전에 oras로 checkpoints/model.pt 에 받아둔다 (.github/workflows/release.yml).
# .dockerignore가 checkpoints/model.pt만 컨텍스트에 포함하므로 이 COPY로 이미지에 baked.
COPY . .

# 모델 누락 방지: oras pull 없이 빌드되면 조용히 깨지지 않게 즉시 실패.
RUN test -f /app/checkpoints/model.pt || \
    (echo "ERROR: checkpoints/model.pt 없음. 먼저 받아라: oras pull ghcr.io/<owner>/davinci-model:latest -o checkpoints" && exit 1)

# config.py: HOST=0.0.0.0, PORT=6000
EXPOSE 6000

CMD ["python", "run.py"]
