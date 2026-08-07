"""Transactional writes for dataset versions."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
import hashlib
import uuid

from .data_lake import DataLake


class TransactionService:
    """Atomic start/write/commit/read operations over the data lake."""

    def __init__(self, data_lake: DataLake) -> None:
        self.data_lake = data_lake
        self._transactions: Dict[str, Dict[str, Any]] = {}
        self._commit_counter = 0

    def start_transaction(
        self,
        dataset_name: str,
        user: str = "system",
    ) -> Tuple[str, bool]:
        tx_id = f"tx_{uuid.uuid4().hex[:12]}"
        self._transactions[tx_id] = {
            "dataset_name": dataset_name,
            "start_time": datetime.now(),
            "user": user,
            "committed": False,
            "aborted": False,
            "containers": [],
            "data": [],
            "parent_version_id": None,
        }
        return tx_id, True

    def write_data(self, transaction_id: str, data: Any) -> bool:
        tx = self._transactions.get(transaction_id)
        if not tx or tx["committed"] or tx["aborted"]:
            return False

        container_id = f"tmp_{transaction_id}_{uuid.uuid4().hex[:8]}"
        self.data_lake._containers[container_id] = data
        payload = str(data).encode("utf-8")
        self.data_lake._container_metadata[container_id] = {
            "dataset_name": tx["dataset_name"],
            "version_id": "pending",
            "created_at": datetime.now(),
            "size_bytes": len(payload),
            "checksum": hashlib.sha256(payload).hexdigest()[:16],
        }
        tx["containers"].append(container_id)
        tx["data"].append(data)
        return True

    def write_delta_data(
        self,
        transaction_id: str,
        delta_data: Dict[str, Any],
        base_version_id: str,
    ) -> bool:
        tx = self._transactions.get(transaction_id)
        if not tx or tx["committed"] or tx["aborted"]:
            return False
        tx["parent_version_id"] = base_version_id
        return self.write_data(transaction_id, delta_data)

    def commit_transaction(self, transaction_id: str) -> Optional[str]:
        tx = self._transactions.get(transaction_id)
        if not tx or tx["committed"] or tx["aborted"]:
            return None

        if not tx["data"]:
            return None

        combined_data = tx["data"][0] if len(tx["data"]) == 1 else tx["data"]
        version = self.data_lake.store_version(
            dataset_name=tx["dataset_name"],
            data=combined_data,
            created_by=tx["user"],
            parent_version_id=tx["parent_version_id"],
            description=f"Committed from transaction {transaction_id}",
        )

        # Drop temporary containers after durable version is stored.
        for cid in tx.get("containers", []):
            self.data_lake.delete_container(cid)

        tx["committed"] = True
        tx["commit_time"] = datetime.now()
        tx["version_id"] = version.version_id
        self._commit_counter += 1
        return version.version_id

    def abort_transaction(self, transaction_id: str) -> bool:
        tx = self._transactions.get(transaction_id)
        if not tx or tx["committed"]:
            return False

        for cid in tx.get("containers", []):
            self.data_lake.delete_container(cid)

        tx["aborted"] = True
        return True

    def read_version(
        self,
        dataset_name: str,
        version_id: Optional[str] = None,
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

    def read_data_from_transaction(self, transaction_id: str) -> Optional[Any]:
        tx = self._transactions.get(transaction_id)
        if not tx or tx["committed"] or tx["aborted"]:
            return None
        if not tx["data"]:
            return None
        return tx["data"][0] if len(tx["data"]) == 1 else tx["data"]

    def get_transaction_status(self, transaction_id: str) -> Dict[str, Any]:
        tx = self._transactions.get(transaction_id)
        if not tx:
            return {"exists": False}
        return {
            "exists": True,
            "dataset_name": tx["dataset_name"],
            "start_time": tx["start_time"].isoformat(),
            "committed": tx["committed"],
            "aborted": tx["aborted"],
            "containers_written": len(tx.get("containers", [])),
            "data_versions": tx.get("version_id"),
        }
