"""Encrypted, persistent key-value store for clients, pending logins, codes and token pairs."""

import os
from pathlib import Path

from key_value.aio.protocols import AsyncKeyValue


def build_store(directory: Path, secret: str, salt: str) -> AsyncKeyValue:
    """A Fernet-encrypted file tree under `directory`. A changed secret turns every stored entry into a
    miss (clients simply log in again) instead of an error."""
    # Before the file store pulls in caio: its io_uring/linux-aio backends take locked kernel memory
    # per store, and Docker's default seccomp profile blocks io_uring. Threads are plenty here.
    os.environ.setdefault("CAIO_IMPL", "thread")
    from key_value.aio.stores.filetree import (
        FileTreeStore,
        FileTreeV1CollectionSanitizationStrategy,
        FileTreeV1KeySanitizationStrategy,
    )
    from key_value.aio.wrappers.encryption import FernetEncryptionWrapper

    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    files = FileTreeStore(data_directory=directory,
                          key_sanitization_strategy=FileTreeV1KeySanitizationStrategy(directory),
                          collection_sanitization_strategy=FileTreeV1CollectionSanitizationStrategy(directory))
    return FernetEncryptionWrapper(key_value=files, source_material=secret, salt=salt,
                                   raise_on_decryption_error=False)
