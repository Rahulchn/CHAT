import unicodedata
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


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
    body: str = Field(min_length=1, max_length=2000)

    @field_validator("body", mode="before")
    @classmethod
    def clean_body(cls, value):
        return value.strip() if isinstance(value, str) else value
