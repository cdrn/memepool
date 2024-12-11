# MemePool - Ethereum Mempool Analysis Service

A service for monitoring Ethereum's mempool, predicting block contents, and analyzing block production.

## Components

- `node/`: Ethereum node configuration and setup
- `backend/`: Main service for mempool monitoring and analysis
  - Mempool monitoring
  - Transaction prediction
  - Block comparison
  - Database integration
- `frontend/`: Web interface for visualization
  - Real-time mempool status
  - Block predictions vs. reality
  - Historical analysis

## Prerequisites

- Docker & Docker Compose
- Node.js >= 16
- Go >= 1.19 (for Geth)
- PostgreSQL >= 14

## Setup

1. Start the Ethereum node:
```bash
cd node
docker-compose up -d
```

2. Start the backend service:
```bash
cd backend
npm install
npm run start
```

3. Start the frontend:
```bash
cd frontend
npm install
npm run dev
```

## Architecture

The system consists of three main components:
1. An Ethereum full node that syncs with the network
2. A backend service that:
   - Monitors the mempool
   - Predicts next block contents
   - Compares predictions with reality
   - Stores data in PostgreSQL
3. A frontend that visualizes the data

## Development Status

🚧 Under Construction 🚧