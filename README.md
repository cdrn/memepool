# MemePool

Real-time Ethereum mempool analysis and block prediction.

## Overview

- Monitors pending transactions in the Ethereum mempool
- Predicts block contents using gas price and transaction type analysis
- Analyzes transaction patterns and protocols
- Visualizes mempool activity and prediction accuracy

## Setup

1. Start Ethereum node:
```bash
cd node && docker-compose up -d
```

2. Start backend:
```bash
cd backend
npm install
npm run dev
```

3. Start frontend:
```bash
cd frontend
npm install
npm run dev
```

## Configuration

- Configure Ethereum node connection in `backend/.env`
- PostgreSQL required for data storage
- See `backend/.env.example` for required environment variables

## Architecture

- Ethereum full node for mempool access
- Backend for analysis and predictions
- Frontend for data visualization
- PostgreSQL for data persistence