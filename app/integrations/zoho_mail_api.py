import httpx


def _headers(access_token: str) -> dict:
    # Zoho's own scheme — "Zoho-oauthtoken", NOT "Bearer" like every other
    # integration in this codebase. Get this wrong and every call 401s.
    return {"Authorization": f"Zoho-oauthtoken {access_token}"}


def get_accounts(access_token: str, api_domain: str) -> list[dict]:
    res = httpx.get(f"https://{api_domain}/api/accounts", headers=_headers(access_token))
    if not res.is_success:
        raise RuntimeError(f"Zoho accounts fetch failed: {res.text}")
    return res.json().get("data", [])


def get_inbox_folder_id(access_token: str, api_domain: str, account_id: str) -> str | None:
    res = httpx.get(
        f"https://{api_domain}/api/accounts/{account_id}/folders",
        headers=_headers(access_token),
    )
    if not res.is_success:
        raise RuntimeError(f"Zoho folders fetch failed: {res.text}")
    for folder in res.json().get("data", []):
        if folder.get("folderType") == "Inbox":
            return folder.get("folderId")
    return None


def _summarize(raw: dict) -> dict:
    # status/status2's exact read/unread encoding isn't confirmed from
    # docs — passed through raw rather than guessed as a boolean.
    return {
        "message_id": raw.get("messageId"),
        "folder_id": raw.get("folderId"),
        "subject": raw.get("subject"),
        "from": raw.get("fromAddress") or raw.get("sender"),
        "to": raw.get("toAddress"),
        "received_time": raw.get("receivedTime"),
        "snippet": raw.get("summary"),
        "has_attachment": raw.get("hasAttachment"),
        "status": raw.get("status"),
        "status2": raw.get("status2"),
    }


def list_recent_messages(
    access_token: str, api_domain: str, account_id: str, folder_id: str, limit: int
) -> list[dict]:
    res = httpx.get(
        f"https://{api_domain}/api/accounts/{account_id}/messages/view",
        headers=_headers(access_token),
        params={"folderId": folder_id, "limit": min(limit, 200), "sortorder": "false"},
    )
    if not res.is_success:
        raise RuntimeError(f"Zoho message list failed: {res.text}")
    return [_summarize(m) for m in res.json().get("data", [])]


def search_messages(
    access_token: str, api_domain: str, account_id: str, search_key: str, limit: int
) -> list[dict]:
    res = httpx.get(
        f"https://{api_domain}/api/accounts/{account_id}/messages/search",
        headers=_headers(access_token),
        params={"searchKey": search_key, "limit": min(limit, 200)},
    )
    if not res.is_success:
        raise RuntimeError(f"Zoho message search failed: {res.text}")
    return [_summarize(m) for m in res.json().get("data", [])]


def get_message_content(
    access_token: str, api_domain: str, account_id: str, folder_id: str, message_id: str
) -> dict:
    res = httpx.get(
        f"https://{api_domain}/api/accounts/{account_id}/folders/{folder_id}/messages/{message_id}/content",
        headers=_headers(access_token),
    )
    if not res.is_success:
        raise RuntimeError(f"Zoho message content fetch failed: {res.text}")
    return res.json().get("data", {})
