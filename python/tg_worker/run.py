#!/usr/bin/env python3
"""
JSON stdin -> JSON stdout bridge for Telethon.
One request object per invocation; Node decrypts/passes session strings and proxy details.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import sys
import traceback
from typing import Any

from telethon import TelegramClient
from telethon.crypto import AuthKey
from telethon.errors import (
    FloodWaitError,
    PasswordHashInvalidError,
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    PhoneNumberBannedError,
    PhoneNumberInvalidError,
    PhoneNumberUnoccupiedError,
    RPCError,
    SessionPasswordNeededError,
    UserDeactivatedError,
)
from telethon.network.connection.tcpmtproxy import (
    ConnectionTcpMTProxyAbridged,
    ConnectionTcpMTProxyIntermediate,
    ConnectionTcpMTProxyRandomizedIntermediate,
)
from telethon.sessions import StringSession
from telethon.tl.functions.messages import SetTypingRequest
from telethon.tl.functions.updates import GetStateRequest
from telethon.tl.types import SendMessageTypingAction, User


def _normalize_mtproxy_secret(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    lower = s.lower()
    if "t.me/proxy?" in lower or "telegram.me/proxy?" in lower or (
        lower.startswith("tg://") and "proxy?" in lower
    ):
        if not lower.startswith(("http://", "https://", "tg://")):
            s = "https://" + s.lstrip("/")
        try:
            from urllib.parse import urlparse, parse_qs

            u = urlparse(s)
            q = parse_qs(u.query)
            sec = (q.get("secret") or [""])[0].strip()
            if sec:
                return _normalize_mtproxy_secret(sec)
        except Exception:
            pass
    # Keep full payload; dd/ee secrets may include extra bytes (e.g. fake-TLS domain).
    return re.sub(r"[^0-9a-fA-F]", "", s).lower()


def _choose_mtproxy_connection_and_secret(secret_hex: str):
    """
    Pick Telethon MTProxy transport by secret prefix.

    - dd... => randomized intermediate (Telethon's intended mode)
    - ee... => fake-TLS secrets. Native Telethon strips domain support and often
      fails against pure fake-TLS-only proxies. If optional TelethonFakeTLS is
      available, use it; otherwise fail with explicit guidance.
    - plain 32-hex => use abridged transport (widest compatibility).
    """
    s = (secret_hex or "").lower()
    if s.startswith("dd"):
        return ConnectionTcpMTProxyRandomizedIntermediate, s
    if s.startswith("ee"):
        # Optional third-party support for fake-TLS.
        try:
            import TelethonFakeTLS  # type: ignore

            # TelethonFakeTLS expects secret without the ee prefix.
            return TelethonFakeTLS.ConnectionTcpMTProxyFakeTLS, s[2:]
        except Exception as imp_err:
            raise ValueError(
                "This MTProxy secret looks like fake-TLS (ee...). Install TelethonFakeTLS in the "
                "Python venv: npm run setup:python (or pip install TelethonFakeTLS in python/.venv). "
                f"Import error: {imp_err!s}"
            ) from imp_err
    # No dd/ee prefix: standard short secret.
    return ConnectionTcpMTProxyAbridged, s


def _fail(code: str, message: str, wait_seconds: int | None = None) -> dict[str, Any]:
    err: dict[str, Any] = {"code": code, "message": message}
    if wait_seconds is not None:
        err["waitSeconds"] = wait_seconds
    return {"ok": False, "error": err}


def _ok(result: Any = None) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": True}
    if result is not None:
        out["result"] = result
    return out


def _gramjs_v1_to_telethon_session(s: str) -> str:
    """Decode gramJS / compatible '1'+base64 StringSession into Telethon's StringSession.save()."""
    s = (s or "").strip()
    if not s or s[0] != "1":
        return s
    raw = base64.b64decode(s[1:], validate=False)
    if len(raw) < 1 + 2 + 2 + 256:
        raise ValueError("session payload too short")
    dc_id = raw[0]
    addr_len = int.from_bytes(raw[1:3], "big")
    o = 3
    host = raw[o : o + addr_len].decode("utf-8")
    o += addr_len
    port = int.from_bytes(raw[o : o + 2], "big")
    o += 2
    auth_key = raw[o:]
    if len(auth_key) != 256:
        raise ValueError("bad auth key length")
    sess = StringSession()
    sess.set_dc(dc_id, host, port)
    sess.auth_key = AuthKey(data=auth_key)
    return sess.save()


def _normalize_session_string(s: str) -> str:
    s = (s or "").strip()
    if not s:
        return s
    if s[0] == "1":
        try:
            return _gramjs_v1_to_telethon_session(s)
        except Exception:
            return s
    return s


def _device_kwargs(req: dict[str, Any]) -> dict[str, Any]:
    d = req.get("device") or {}
    out = {}
    if isinstance(d, dict):
        for k_src, k_dst in (
            ("deviceModel", "device_model"),
            ("systemVersion", "system_version"),
            ("appVersion", "app_version"),
            ("langCode", "lang_code"),
            ("systemLangCode", "system_lang_code"),
        ):
            v = d.get(k_src)
            if v is not None and str(v).strip():
                out[k_dst] = str(v).strip()
    return out


def _parse_api_id(raw: Any) -> int:
    if raw is None:
        raise ValueError(
            "apiId is null/missing in bridge request — set telegramApiId on the account or TG_API_ID in .env (must be a positive integer)."
        )
    if isinstance(raw, bool):
        raise ValueError(f"apiId must be numeric, got boolean: {raw}")
    try:
        n = int(raw)
    except (TypeError, ValueError) as e:
        raise ValueError(f"apiId is not a valid integer: {raw!r}") from e
    if n <= 0:
        raise ValueError(f"apiId must be positive, got {n}")
    return n


def _parse_api_hash(raw: Any) -> str:
    if raw is None:
        raise ValueError(
            "apiHash is null/missing — set telegramApiHash on the account or TG_API_HASH in .env."
        )
    s = str(raw).strip()
    if not s:
        raise ValueError("apiHash is empty after trim")
    return s


def _bridge_int(
    req: dict[str, Any],
    key: str,
    default: int,
    *,
    min_v: int,
    max_v: int | None = None,
) -> int:
    raw = req.get(key)
    if raw is None:
        return default
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return default
    if n < min_v:
        n = min_v
    if max_v is not None and n > max_v:
        n = max_v
    return n


def _make_client(req: dict[str, Any], session_str: str) -> TelegramClient:
    api_id = _parse_api_id(req.get("apiId"))
    api_hash = _parse_api_hash(req.get("apiHash"))
    sess = StringSession(_normalize_session_string(session_str))
    proxy = req.get("proxy") or {}
    ptype = (proxy.get("type") or "none").lower()
    kwargs: dict[str, Any] = {
        **_device_kwargs(req),
        "connection_retries": _bridge_int(req, "connectionRetries", 5, min_v=1, max_v=20),
        "retry_delay": _bridge_int(req, "retryDelay", 1, min_v=0, max_v=60),
        "timeout": _bridge_int(req, "timeout", 10, min_v=5, max_v=120),
        "auto_reconnect": False,
        "flood_sleep_threshold": int(req.get("floodSleepThreshold") or 60),
    }

    if ptype == "mtproto":
        host = str(proxy.get("host") or "")
        port = int(proxy.get("port") or 443)
        secret_hex = _normalize_mtproxy_secret(str(proxy.get("secret") or ""))
        is_classic = bool(re.fullmatch(r"[0-9a-f]{32}", secret_hex))
        is_ddee = bool(re.fullmatch(r"(dd|ee)[0-9a-f]{32,}", secret_hex)) and (len(secret_hex) % 2 == 0)
        if not secret_hex or not (is_classic or is_ddee):
            raise ValueError(
                "MTProxy secret must be either 16-byte hex (32 chars) or dd/ee-prefixed hex payload"
            )
        conn_cls, secret_for_conn = _choose_mtproxy_connection_and_secret(secret_hex)
        # Telethon's TcpMTProxy.normalize_secret expects a hex/base64 *string*, not raw
        # bytes; passing bytes triggers ValueError in fromhex() then str/bytes concat in
        # the base64 fallback (TypeError: can't concat str to bytes).
        return TelegramClient(
            sess,
            api_id,
            api_hash,
            proxy=(host, port, secret_for_conn),
            connection=conn_cls,
            **kwargs,
        )

    if ptype in ("socks5", "http"):
        host = str(proxy.get("host") or "")
        port = int(proxy.get("port") or (1080 if ptype == "socks5" else 8080))
        user = str(proxy.get("username") or "")
        pwd = str(proxy.get("password") or "")
        tup: Any = (ptype, host, port)
        if user or pwd:
            tup = (ptype, host, port, True, user, pwd)
        return TelegramClient(sess, api_id, api_hash, proxy=tup, **kwargs)

    return TelegramClient(sess, api_id, api_hash, **kwargs)


def _proxy_network_hint(req: dict[str, Any] | None) -> str:
    if not req:
        return ""
    p = req.get("proxy")
    if not isinstance(p, dict):
        return ""
    pt = str(p.get("type") or "none").lower()
    if pt in ("", "none"):
        return ""
    host = p.get("host")
    port = p.get("port")
    if pt == "mtproto":
        return (
            f" Using MTProxy {host!s}:{port!s}: confirm host/port/secret, that the proxy is up, "
            "and that your network allows outbound TCP to it. Try the same proxy in the official "
            "Telegram app; try login without --proxy-id to see if direct connection works."
        )
    if pt == "socks5":
        return (
            f" Using SOCKS5 {host!s}:{port!s}: confirm host/port/credentials and outbound access. "
            "Try login without --proxy-id if you need to rule out the proxy."
        )
    if pt == "http":
        return (
            f" Using HTTP proxy {host!s}:{port!s}: confirm host/port/credentials and outbound access. "
            "Try login without --proxy-id if you need to rule out the proxy."
        )
    return ""


def _rpc_to_err(exc: Exception, req: dict[str, Any] | None = None) -> dict[str, Any]:
    if isinstance(exc, ValueError):
        return _fail("INVALID_INPUT", str(exc))
    if isinstance(exc, TypeError):
        return _fail("INVALID_INPUT", str(exc) or "TypeError in Telethon bridge")
    if isinstance(exc, FloodWaitError):
        sec = int(exc.seconds)
        return _fail(f"FLOOD_WAIT_{sec}", str(exc), sec)
    if isinstance(exc, PhoneNumberBannedError):
        return _fail("PHONE_NUMBER_BANNED", str(exc))
    if isinstance(exc, (PhoneNumberInvalidError, PhoneNumberUnoccupiedError)):
        return _fail(exc.__class__.__name__.upper(), str(exc))
    if isinstance(exc, (PhoneCodeInvalidError, PhoneCodeExpiredError)):
        return _fail(exc.__class__.__name__.upper(), str(exc))
    if isinstance(exc, SessionPasswordNeededError):
        return _fail("SESSION_PASSWORD_NEEDED", str(exc))
    if isinstance(exc, UserDeactivatedError):
        return _fail("USER_DEACTIVATED", str(exc))
    if isinstance(exc, PasswordHashInvalidError):
        return _fail("PASSWORD_HASH_INVALID", str(exc))
    if isinstance(exc, RPCError):
        return _fail(exc.error_message or "RPC_ERROR", str(exc))
    msg = str(exc) or exc.__class__.__name__
    if re.search(r"ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|TIMEOUT|CONNECTION", msg, re.I):
        msg = msg + _proxy_network_hint(req)
        return _fail("NETWORK", msg)
    return _fail(exc.__class__.__name__.upper(), msg)


async def handle_get_me(req: dict[str, Any]) -> dict[str, Any]:
    session = str(req.get("session") or "")
    client = _make_client(req, session)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            return _fail("AUTH_KEY_UNREGISTERED", "Session not authorized")
        me = await client.get_me()
        return _ok(
            {
                "userId": str(me.id),
                "username": me.username or "",
                "session": client.session.save(),
            }
        )
    except Exception as exc:
        return _rpc_to_err(exc, req)
    finally:
        await client.disconnect()


async def handle_get_state(req: dict[str, Any]) -> dict[str, Any]:
    session = str(req.get("session") or "")
    client = _make_client(req, session)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            return _fail("AUTH_KEY_UNREGISTERED", "Session not authorized")
        await client(GetStateRequest())
        return _ok({})
    except Exception as exc:
        return _rpc_to_err(exc, req)
    finally:
        await client.disconnect()


def _normalize_username(raw: str) -> str:
    return str(raw or "").strip().lstrip("@").lower()


def _phone_digits(raw: str) -> str:
    return re.sub(r"\D", "", str(raw or ""))


def _peer_matches_filter(entity: Any, req: dict[str, Any]) -> bool:
    """When peer* filters are set, only scan that dialog."""
    want_uid = str(req.get("peerUserId") or "").strip()
    want_user = _normalize_username(str(req.get("peerUsername") or ""))
    want_phone = _phone_digits(str(req.get("peerPhone") or ""))
    if not want_uid and not want_user and not want_phone:
        return True
    if not isinstance(entity, User):
        return False
    if want_uid and str(getattr(entity, "id", "") or "") == want_uid:
        return True
    if want_user and _normalize_username(str(getattr(entity, "username", "") or "")) == want_user:
        return True
    ent_phone = _phone_digits(str(getattr(entity, "phone", "") or ""))
    if want_phone and ent_phone and ent_phone == want_phone:
        return True
    return False


async def handle_set_typing(req: dict[str, Any]) -> dict[str, Any]:
    session = str(req.get("session") or "")
    peer = str(req.get("peer") or "").strip()
    seconds = _bridge_int(req, "seconds", 3, min_v=1, max_v=30)
    if not peer:
        return _fail("PEER_EMPTY", "Empty peer")
    client = _make_client(req, session)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            return _fail("AUTH_KEY_UNREGISTERED", "Session not authorized")
        entity = await client.get_entity(peer)
        await client(SetTypingRequest(entity, SendMessageTypingAction()))
        await asyncio.sleep(seconds)
        return _ok({})
    except Exception as exc:
        return _rpc_to_err(exc, req)
    finally:
        await client.disconnect()


async def handle_send_message(req: dict[str, Any]) -> dict[str, Any]:
    session = str(req.get("session") or "")
    peer = str(req.get("peer") or "").strip()
    text = str(req.get("text") or "")
    if not peer:
        return _fail("PEER_EMPTY", "Empty peer")
    client = _make_client(req, session)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            return _fail("AUTH_KEY_UNREGISTERED", "Session not authorized")
        msg = await client.send_message(peer, text)
        rid = getattr(msg, "random_id", None)
        return _ok({"randomId": str(rid) if rid is not None else ""})
    except Exception as exc:
        return _rpc_to_err(exc, req)
    finally:
        await client.disconnect()


async def handle_list_incoming(req: dict[str, Any]) -> dict[str, Any]:
    session = str(req.get("session") or "")
    client = _make_client(req, session)
    limit = _bridge_int(req, "limit", 100, min_v=1, max_v=500)
    per_dialog_limit = _bridge_int(req, "perDialogLimit", 5, min_v=1, max_v=50)
    dialog_limit = _bridge_int(req, "dialogLimit", 80, min_v=1, max_v=500)
    since_epoch_sec = _bridge_int(req, "sinceEpochSec", 0, min_v=0)
    include_outgoing = bool(req.get("includeOutgoing"))
    mark_read = bool(req.get("markRead"))
    peer_filter_active = bool(
        str(req.get("peerUserId") or "").strip()
        or _normalize_username(str(req.get("peerUsername") or ""))
        or _phone_digits(str(req.get("peerPhone") or ""))
    )
    out: list[dict[str, Any]] = []
    dialogs_scanned = 0
    dialogs_marked_read = 0
    peers_marked_read: list[str] = []

    try:
        await client.connect()
        if not await client.is_user_authorized():
            return _fail("AUTH_KEY_UNREGISTERED", "Session not authorized")

        async for dialog in client.iter_dialogs(limit=dialog_limit):
            entity = dialog.entity
            if isinstance(entity, User) and getattr(entity, "bot", False):
                continue
            if not _peer_matches_filter(entity, req):
                continue

            dialogs_scanned += 1
            peer_user_id = str(getattr(entity, "id", "") or "") if isinstance(entity, User) else ""
            unread_count = int(getattr(dialog, "unread_count", 0) or 0)

            async for msg in client.iter_messages(entity, limit=per_dialog_limit):
                incoming = bool(getattr(msg, "incoming", False))
                msg_id = int(getattr(msg, "id", 0) or 0)
                if not incoming and not include_outgoing:
                    continue
                text = str(getattr(msg, "message", "") or "").strip()
                dt = getattr(msg, "date", None)
                ts = int(dt.timestamp()) if dt else 0
                if since_epoch_sec > 0 and ts < since_epoch_sec:
                    continue
                # When marking read, still list recent incoming without text (media-only replies).
                if not text and not (mark_read and incoming):
                    continue

                sender_user_id = str(getattr(msg, "sender_id", "") or "")
                row_peer_user_id = peer_user_id or sender_user_id
                out.append(
                    {
                        "messageId": msg_id,
                        "dateEpochSec": ts,
                        "text": text,
                        "peerUserId": row_peer_user_id,
                        "peerUsername": str(getattr(entity, "username", "") or ""),
                        "peerPhone": str(getattr(entity, "phone", "") or ""),
                        "peerFirstName": str(getattr(entity, "first_name", "") or ""),
                        "peerLastName": str(getattr(entity, "last_name", "") or ""),
                        "senderUserId": sender_user_id,
                        "direction": "incoming" if incoming else "outgoing",
                    }
                )

            # Mark the whole dialog read so the recipient sees blue checks on their messages.
            # Use full read ack (no max_id cap) so messages outside per_dialog_limit are included.
            if mark_read and (unread_count > 0 or peer_filter_active):
                try:
                    await client.send_read_acknowledge(entity)
                    dialogs_marked_read += 1
                    if peer_user_id:
                        peers_marked_read.append(peer_user_id)
                except Exception:
                    pass

        out.sort(key=lambda x: int(x.get("dateEpochSec") or 0), reverse=True)
        return _ok(
            {
                "items": out[:limit],
                "dialogsScanned": dialogs_scanned,
                "dialogsMarkedRead": dialogs_marked_read,
                "peersMarkedRead": peers_marked_read,
            }
        )
    except Exception as exc:
        return _rpc_to_err(exc, req)
    finally:
        await client.disconnect()


async def handle_auth_send_code(req: dict[str, Any]) -> dict[str, Any]:
    phone = str(req.get("phone") or "").strip()
    force_sms = bool(req.get("forceSMS"))
    session = str(req.get("session") or "")
    client = _make_client(req, session)
    try:
        await client.connect()
        sent = await client.send_code_request(phone, force_sms=force_sms)
        return _ok(
            {
                "phoneCodeHash": sent.phone_code_hash,
                "session": client.session.save(),
            }
        )
    except Exception as exc:
        return _rpc_to_err(exc, req)
    finally:
        await client.disconnect()


async def handle_auth_sign_in(req: dict[str, Any]) -> dict[str, Any]:
    phone = str(req.get("phone") or "").strip()
    code = str(req.get("code") or "").strip()
    phone_hash = str(req.get("phoneCodeHash") or "").strip()
    session = str(req.get("session") or "")
    client = _make_client(req, session)
    try:
        await client.connect()
        await client.sign_in(phone, code, phone_code_hash=phone_hash)
        me = await client.get_me()
        return _ok(
            {
                "userId": str(me.id),
                "username": me.username or "",
                "session": client.session.save(),
                "needsPassword": False,
            }
        )
    except SessionPasswordNeededError:
        return _ok(
            {
                "needsPassword": True,
                "session": client.session.save(),
            }
        )
    except Exception as exc:
        return _rpc_to_err(exc, req)
    finally:
        await client.disconnect()


async def handle_auth_password(req: dict[str, Any]) -> dict[str, Any]:
    password = str(req.get("password") or "")
    session = str(req.get("session") or "")
    client = _make_client(req, session)
    try:
        await client.connect()
        await client.sign_in(password=password)
        me = await client.get_me()
        return _ok(
            {
                "userId": str(me.id),
                "username": me.username or "",
                "session": client.session.save(),
            }
        )
    except Exception as exc:
        return _rpc_to_err(exc, req)
    finally:
        await client.disconnect()


HANDLERS = {
    "get_me": handle_get_me,
    "get_state": handle_get_state,
    "send_message": handle_send_message,
    "set_typing": handle_set_typing,
    "list_incoming": handle_list_incoming,
    "auth_send_code": handle_auth_send_code,
    "auth_sign_in": handle_auth_sign_in,
    "auth_password": handle_auth_password,
}


async def _amain(req: dict[str, Any]) -> dict[str, Any]:
    action = str(req.get("action") or "")
    fn = HANDLERS.get(action)
    if not fn:
        return _fail("BAD_ACTION", f"Unknown action {action!r}")
    try:
        return await fn(req)
    except ValueError as ve:
        return _fail("INVALID_INPUT", str(ve))
    except Exception as exc:
        return {
            "ok": False,
            "error": {
                "code": "PYTHON_EXCEPTION",
                "message": str(exc),
                "traceback": traceback.format_exc(),
            },
        }


def main() -> None:
    # Surface Telethon "Attempt N at connecting failed: ..." on stderr for the Node bridge.
    if not logging.getLogger().handlers:
        logging.basicConfig(
            level=logging.WARNING,
            stream=sys.stderr,
            format="%(name)s: %(message)s",
        )
    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as je:
        print(json.dumps(_fail("BAD_JSON", str(je))))
        sys.exit(2)
    result = asyncio.run(_amain(req))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
