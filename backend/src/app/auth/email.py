import asyncio
import smtplib
from email.message import EmailMessage

from app.config import settings


class EmailNotConfiguredError(RuntimeError):
    pass


async def send_password_reset_email(*, to_email: str, reset_url: str) -> None:
    if not settings.smtp_host or not settings.smtp_from_email:
        raise EmailNotConfiguredError("SMTP is not configured")

    message = EmailMessage()
    message["Subject"] = "重置密码"
    message["From"] = settings.smtp_from_email
    message["To"] = to_email
    message.set_content(
        "\n".join(
            [
                "你正在申请重置密码。",
                "",
                f"请点击下面的链接完成密码重置，链接将在 {settings.password_reset_token_expire_minutes} 分钟后失效：",
                reset_url,
                "",
                "如果不是你本人操作，请忽略这封邮件。",
            ]
        )
    )

    await asyncio.to_thread(_send_message, message)


def _send_message(message: EmailMessage) -> None:
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
        if settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_username and settings.smtp_password:
            server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(message)
