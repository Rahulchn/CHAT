import unicodedata
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


class JoinRoom(BaseModel):
    type: Literal["join"]
    name: str = Field(min_length=1, max_length=40)
    client_id: UUID
    avatar: Literal[
        "orbit", "bloom", "pixel", "comet", "sunny", "wave", "sage", "luna",
        "gigachad", "jonah-hill", "roll-safe", "patrick", "handsome-squidward",
        "sad-frog", "facepalm", "doge",
    ] = "gigachad"

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, value):
        if not isinstance(value, str):
            return value
        value = " ".join(value.split())
        if any(unicodedata.category(char).startswith("C") for char in value):
            raise ValueError("Name contains invisible control characters")
        return value


class OutgoingMessage(BaseModel):
    type: Literal["message"]
    body: str = Field(default="", max_length=2000)
    image_url: str | None = Field(default=None, max_length=80)

    @field_validator("body", mode="before")
    @classmethod
    def clean_body(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("image_url")
    @classmethod
    def clean_image_url(cls, value):
        if value is None:
            return value
        value = value.strip()
        parts = value.split("/")
        if len(parts) != 4 or parts[:3] != ["", "api", "uploads"]:
            raise ValueError("Image URL must reference a local upload")
        filename = parts[3]
        stem, separator, extension = filename.partition(".")
        if separator != "." or len(stem) != 32 or any(char not in "0123456789abcdef" for char in stem):
            raise ValueError("Invalid uploaded image name")
        if extension not in {"png", "jpg", "webp", "gif"}:
            raise ValueError("Unsupported uploaded image type")
        return value

    @model_validator(mode="after")
    def require_content(self):
        if not self.body and not self.image_url:
            raise ValueError("Message must include text or an image")
        return self
