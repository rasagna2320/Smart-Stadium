import json
import random
import time
from datetime import datetime
from kafka import KafkaProducer

producer = KafkaProducer(
    bootstrap_servers="localhost:9092",
    value_serializer=lambda v: json.dumps(v).encode("utf-8")
)

TOPIC = "locations"

# Stadium center (example Hyderabad)
CENTER_LAT = 17.4065
CENTER_LON = 78.4772

TOTAL_USERS = 50000

print("Streaming GPS locations...")

while True:
    for _ in range(1000):   # send 1000 events each cycle

        user_id = random.randint(1, TOTAL_USERS)

        # 70% inside stadium, 30% outside
        if random.random() < 0.7:
            lat = CENTER_LAT + random.uniform(-0.0015, 0.0015)
            lon = CENTER_LON + random.uniform(-0.0015, 0.0015)
        else:
            lat = CENTER_LAT + random.uniform(-0.02, 0.02)
            lon = CENTER_LON + random.uniform(-0.02, 0.02)

        payload = {
            "user_id": user_id,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "timestamp": datetime.utcnow().isoformat()
        }

        producer.send(TOPIC, payload)

    producer.flush()

    print("Sent 1000 GPS events")
    time.sleep(1)