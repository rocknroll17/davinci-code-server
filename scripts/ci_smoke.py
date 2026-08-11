"""CI smoke test: byte-compile + import the FastAPI app.

Importing app.main builds the FastAPI `app` at module scope but does NOT run
the lifespan handler (which calls model_loader.load()). So this verifies all
imports, route registration, and static mounting without needing the model
checkpoint, which CI does not have.
"""
import importlib
import os
import sys

# Make the repo root importable regardless of the working directory.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> None:
    m = importlib.import_module("app.main")
    assert hasattr(m, "app"), "FastAPI app not found in app.main"
    # Starlette >=1.6 no longer flattens include_router() sub-routes into
    # app.routes, so enumerate paths via the OpenAPI schema instead.
    paths = list(m.app.openapi()["paths"])
    assert any(p.startswith("/api") for p in paths), "no /api routes registered"
    print(f"[smoke] app imports OK — {len(paths)} API paths registered")


if __name__ == "__main__":
    main()
