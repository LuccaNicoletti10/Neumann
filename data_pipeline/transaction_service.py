"""Transaction service (FIG. 9 START/WRITE/COMMIT)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple
import uuid

from .core_types import BuildMessage, DatasetType, TransactionEntry
from .data_lake import DataLake


class TransactionService:
    def __init__(self, data_lake: DataLake) -> None:
        self.data_lake = data_lake
        self._commit_counter = 0
        self._message_queue: List[BuildMessage] = []
        self._build_listeners: List[Callable[[str, str], None]] = []
        self._transaction_log: List[TransactionEntry] = []

    def add_build_listener(self, listener: Callable[[str, str], None]) -> None:
        self._build_listeners.append(listener)

    def start_transaction(
        self, dataset_name: str, user: str = "system"
    ) -> Tuple[str, bool]:
        if dataset_name not in self.data_lake._dataset_types:
            self.data_lake.create_dataset(dataset_name, DatasetType.BASE)

        tx_id = f"tx_{uuid.uuid4().hex[:12]}"
        transaction = TransactionEntry(
            dataset_name=dataset_name,
            transaction_id=tx_id,
            start_timestamp=datetime.now(),
            user=user,
        )
        self.data_lake._transactions[tx_id] = transaction
        self._transaction_log.append(transaction)
        return tx_id, True

    def write_data(self, transaction_id: str, data: Any) -> bool:
        tx = self.data_lake._transactions.get(transaction_id)
        if not tx or tx.committed or tx.abort_timestamp is not None:
            return False

        container_id = f"tmp_{transaction_id}_{uuid.uuid4().hex[:8]}"
        self.data_lake._containers[container_id] = data
        self.data_lake._container_metadata[container_id] = {
            "dataset_name": tx.dataset_name,
            "version_id": "pending",
            "created_at": datetime.now().isoformat(),
            "size_bytes": self.data_lake._calculate_size(data),
            "checksum": self.data_lake._calculate_checksum(data),
            "is_temporary": True,
            "transaction_id": transaction_id,
        }
        tx.container_ids.append(container_id)
        tx.data_written.append(data)
        return True

    def write_delta_data(
        self,
        transaction_id: str,
        delta_data: Dict[str, Any],
        base_version_id: str,
    ) -> bool:
        tx = self.data_lake._transactions.get(transaction_id)
        if not tx or tx.committed or tx.abort_timestamp is not None:
            return False
        tx.parent_version_id = base_version_id
        return self.write_data(transaction_id, delta_data)

    def commit_transaction(self, transaction_id: str) -> Optional[str]:
        tx = self.data_lake._transactions.get(transaction_id)
        if not tx or tx.committed or tx.abort_timestamp is not None:
            return None
        if not tx.data_written:
            return None

        combined = tx.data_written[0] if len(tx.data_written) == 1 else tx.data_written
        self._commit_counter += 1
        commit_id = f"c{self._commit_counter:04d}"

        lineage_depth = 0
        if tx.parent_version_id:
            parent = self.data_lake.get_version(tx.dataset_name, tx.parent_version_id)
            if parent:
                lineage_depth = parent.lineage_depth + 1

        version = self.data_lake.store_version(
            dataset_name=tx.dataset_name,
            data=combined,
            created_by=tx.user,
            parent_version_id=tx.parent_version_id,
            description=f"Committed from transaction {transaction_id}",
            use_delta=tx.parent_version_id is not None,
            lineage_depth=lineage_depth,
        )

        tx.committed = True
        tx.commit_timestamp = datetime.now()
        tx.commit_identifier = commit_id

        for cid in tx.container_ids:
            meta = self.data_lake._container_metadata.get(cid)
            if meta:
                meta["version_id"] = version.version_id
                meta["committed"] = True
                meta["commit_id"] = commit_id
                meta.pop("is_temporary", None)

        self._message_queue.append(
            BuildMessage(
                dataset_name=tx.dataset_name,
                new_version_id=version.version_id,
                triggered_at=datetime.now(),
                trigger_type="transaction_commit",
            )
        )
        for listener in self._build_listeners:
            try:
                listener(tx.dataset_name, version.version_id)
            except Exception:
                pass
        return version.version_id

    def abort_transaction(self, transaction_id: str) -> bool:
        tx = self.data_lake._transactions.get(transaction_id)
        if not tx or tx.committed:
            return False
        for cid in tx.container_ids:
            self.data_lake.delete_container(cid)
        tx.abort_timestamp = datetime.now()
        return True

    def read_version(
        self, dataset_name: str, version_id: Optional[str] = None
    ) -> Optional[Any]:
        if version_id is None:
            version = self.data_lake.get_latest_version(dataset_name)
            if not version:
                return None
            version_id = version.version_id
        version = self.data_lake.get_version(dataset_name, version_id)
        if not version or not version.is_committed:
            return None
        return self.data_lake.get_data_for_version(dataset_name, version_id)

    def get_pending_messages(self) -> List[BuildMessage]:
        messages = self._message_queue.copy()
        self._message_queue.clear()
        return messages

    def has_pending_messages(self) -> bool:
        return bool(self._message_queue)

    def get_transaction_status(self, transaction_id: str) -> Dict[str, Any]:
        tx = self.data_lake._transactions.get(transaction_id)
        if not tx:
            return {"exists": False}
        return {
            "exists": True,
            "dataset_name": tx.dataset_name,
            "start_timestamp": tx.start_timestamp.isoformat(),
            "committed": tx.committed,
            "aborted": tx.abort_timestamp is not None,
            "containers_written": len(tx.container_ids),
            "commit_identifier": tx.commit_identifier,
            "duration_seconds": (
                datetime.now() - tx.start_timestamp
            ).total_seconds(),
        }
