from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class Database:
    def __init__(self, url: str) -> None:
        self.engine = create_async_engine(url)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def create_tables(self) -> None:
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
            # Add the new display field without touching existing message history.
            columns = await connection.run_sync(
                lambda sync: {column["name"] for column in inspect(sync).get_columns("group_messages")}
            )
            if "avatar" not in columns:
                await connection.execute(text(
                    "ALTER TABLE group_messages ADD COLUMN avatar VARCHAR(20) NOT NULL DEFAULT 'orbit'"
                ))
            if "image_url" not in columns:
                await connection.execute(text(
                    "ALTER TABLE group_messages ADD COLUMN image_url VARCHAR(80)"
                ))
