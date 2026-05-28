import json
from datetime import datetime
from kafka import KafkaProducer

producer = KafkaProducer(
    bootstrap_servers="localhost:9092",
    value_serializer=lambda v: json.dumps(v).encode("utf-8")
)

TOPIC = "goals"

while True:
    input("Press ENTER when Goal is Scored...")

    payload = {
        "event": "GOAL",
        "timestamp": datetime.utcnow().isoformat()
    }

    producer.send(TOPIC, payload)
    producer.flush()

    print("Goal Event Sent!")