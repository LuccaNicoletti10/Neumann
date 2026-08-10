# ADR-0002: Parquet + MinIO em vez de Iceberg/Delta

**Contexto:** F2 exige store imutável com time travel.
**Decisão:** Versões de dataset = arquivos Parquet imutáveis no MinIO, content-hash sha256, manifests no Postgres.
**Alternativa rejeitada:** Iceberg/Delta — exigem JVM/catálogo, complexidade desproporcional agora.
**Consequência:** Upgrade para Iceberg fica aberto; nenhum contrato depende da implementação.
