# platform-api

Neumann `/api/v2` surface (Foundry-inspired; OpenFoundry Apache-2.0 route shapes adapted).

```
/api/v2/ontologies
/api/v2/ontologies/{ontology}/objectTypes
/api/v2/ontologies/{ontology}/objects/{objectType}
/api/v2/ontologies/{ontology}/objects/{objectType}/{primaryKey}
/api/v2/ontologies/{ontology}/objects/{objectType}/{primaryKey}/links/{linkType}
/api/v2/ontologies/{ontology}/objectSets/loadObjects
/api/v2/ontologies/{ontology}/objectSets/aggregate
/api/v2/ontologies/{ontology}/actionTypes
/api/v2/ontologies/{ontology}/actions/{action}/validate
/api/v2/ontologies/{ontology}/actions/{action}/apply
```

Modular monolith — library packages behind a single Fastify app. No microservices yet.
