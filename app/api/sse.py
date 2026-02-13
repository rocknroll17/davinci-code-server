"""
Game API Routes - PvP 구조 + SSE
"""

import asyncio
import json
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.services.game_manager import game_manager
from app.core.exceptions import handle_game_error

router = APIRouter(prefix="/game", tags=["game"])


# ==================== SSE 이벤트 스트림 ====================

@router.get("/events")
async def event_stream(
    game_id: str = Query(..., description="게임 ID"),
    player_id: str = Query(..., description="플레이어 ID")
):
    """
    SSE 이벤트 스트림
    
    플레이어가 연결하면 게임 이벤트를 실시간으로 수신.
    - game_start: 게임 시작
    - opponent_action: 상대방 행동
    - turn_change: 턴 변경
    - game_over: 게임 종료
    """
    try:
        session = game_manager.get_game(game_id)
        player_index = session.get_player_index(player_id)
    except Exception as e:
        error_msg = str(e)
        async def error_stream():
            yield f"event: error\ndata: {json.dumps({'error': error_msg})}\n\n"
        return StreamingResponse(
            error_stream(),
            media_type="text/event-stream"
        )
    
    async def generate():
        queue = session.register_listener(player_id)
        try:
            # 연결 확인 이벤트
            yield f"event: connected\ndata: {json.dumps({'player_index': player_index})}\n\n"
            
            while True:
                try:
                    # 30초마다 heartbeat (연결 유지)
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    # event는 {"type": ..., "data": ...} 형식
                    event_type = event.get("type", "unknown")
                    event_data = json.dumps({
                        "type": event_type,
                        **event.get("data", {})
                    })
                    yield f"event: {event_type}\ndata: {event_data}\n\n"
                    
                except asyncio.TimeoutError:
                    # Heartbeat
                    yield f"event: heartbeat\ndata: {json.dumps({'status': 'alive'})}\n\n"
                    
        except asyncio.CancelledError:
            # 클라이언트 연결 끊김 - 상대방에게 알림
            session.player_disconnected(player_id)
        finally:
            session.unregister_listener(player_id)
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # nginx 버퍼링 비활성화
        }
    )
