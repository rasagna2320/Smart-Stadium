from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from kafka import KafkaProducer, KafkaConsumer
import json
from datetime import datetime

app = FastAPI(title="Smart Stadium API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

producer = KafkaProducer(
    bootstrap_servers="localhost:9092",
    value_serializer=lambda v: json.dumps(v).encode("utf-8")
)

# ----------------------

@app.get("/")
def home():
    return {"message": "Smart Stadium API Running 🚀"}

# ----------------------

@app.get("/goal")
def trigger_goal():
    payload = {
        "event": "GOAL",
        "timestamp": datetime.utcnow().isoformat()
    }

    producer.send("goals", payload)
    producer.flush()

    return {"status": "Goal Triggered"}

# ----------------------

@app.get("/stats")
def stats():
    # mock dynamic stats for now
    return {
        "active_users": 50000,
        "inside_stadium": 34892,
        "coupons_sent": 34892,
        "goals_today": 3
    }

# ----------------------

@app.get("/coupons")
def coupons():
    consumer = KafkaConsumer(
        "coupons",
        bootstrap_servers="localhost:9092",
        value_deserializer=lambda m: json.loads(m.decode("utf-8")),
        auto_offset_reset="latest",
        consumer_timeout_ms=1000
    )

    data = []

    for msg in consumer:
        data.append(msg.value)

    return data[-20:]