# Architecture Overview

This diagram shows a typical distributed web application architecture with a frontend, API layer, service components, data stores, and observability tooling.

```mermaid
flowchart LR
    U[Users / Clients] --> FE[Frontend App\nReact / Next.js]
    FE --> GW[API Gateway]
    GW --> AUTH[Authentication Service]
    GW --> ORD[Orders Service]
    GW --> BILL[Billing Service]
    GW --> NOTIF[Notification Service]

    ORD --> DB[(PostgreSQL)]
    BILL --> DB
    AUTH --> DB

    ORD --> CACHE[(Redis)]
    BILL --> CACHE
    NOTIF --> SMTP[Email/SMS Provider]

    FE --> CDN[Static Assets / CDN]
    GW --> OBS[Observability Stack\nLogs / Metrics / Traces]

    subgraph Platform
        FE
        GW
        AUTH
        ORD
        BILL
        NOTIF
    end

    subgraph Data
        DB
        CACHE
        SMTP
    end

    subgraph Ops
        OBS
        CDN
    end