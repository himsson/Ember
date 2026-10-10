"""Telegram bot without extra packages. Put the token from @BotFather into the file token.txt."""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

TOKEN = Path(__file__).with_name("token.txt").read_text(encoding="utf-8").strip()
API = f"https://api.telegram.org/bot{TOKEN}/"


def call(method, **params):
    data = urllib.parse.urlencode(params).encode()
    with urllib.request.urlopen(API + method, data=data, timeout=40) as res:
        return json.load(res)["result"]


def reply(text):
    """Return the answer to a message. The logic of the bot goes here."""
    if text == "/start":
        return "Hello! Send me a message."
    return "You said: " + text


def main():
    offset = 0
    print("Bot is running. Press Ctrl+C to stop.")
    while True:
        try:
            for update in call("getUpdates", offset=offset, timeout=30):
                offset = update["update_id"] + 1
                message = update.get("message") or {}
                if "text" in message:
                    call("sendMessage", chat_id=message["chat"]["id"], text=reply(message["text"]))
        except OSError as error:
            print("Connection problem:", error)
            time.sleep(3)


if __name__ == "__main__":
    main()
