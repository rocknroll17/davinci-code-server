# Da Vinci Code — Game Server (FastAPI + uvicorn)
# README 기준 Python 3.10
FROM python:3.14-slim

WORKDIR /app

# 의존성 먼저 복사 → 레이어 캐시 활용.
# torch>=2.9.0 기본 휠 = CUDA 빌드. `docker run --gpus all`로 GPU 추론,
# 플래그 없이 실행하면 CPU로 자동 폴백(torch.cuda.is_available()).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 복사
COPY . .

# 학습된 모델(.pt)은 .gitignore로 제외돼 이미지에 안 들어감.
# 실행 시 호스트의 체크포인트를 마운트해야 AI 플레이어가 동작:
#   docker run -p 6000:6000 -v $(pwd)/checkpoints:/app/checkpoints ...
VOLUME ["/app/checkpoints"]

# config.py: HOST=0.0.0.0, PORT=6000
EXPOSE 6000

CMD ["python", "run.py"]
