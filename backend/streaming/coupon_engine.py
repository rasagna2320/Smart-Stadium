import json
import math
from datetime import datetime, timedelta

from kafka import KafkaConsumer, KafkaProducer

location_consumer = KafkaConsumer(
    "locations",
    bootstrap_servers="localhost:9092",
    value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    auto_offset_reset="latest"
)

goal_consumer = KafkaConsumer(
    "goals",
    bootstrap_servers="localhost:9092",
    value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    auto_offset_reset="latest"
)

producer = KafkaProducer(
    bootstrap_servers="localhost:9092",
    value_serializer=lambda v: json.dumps(v).encode("utf-8")
)

CENTER_LAT = 17.4065
CENTER_LON = 78.4772
RADIUS_KM = 0.25

latest_users = {}

def distance_km(lat1, lon1, lat2, lon2):
    return math.sqrt((lat1-lat2)**2 + (lon1-lon2)**2) * 111

print("Coupon Engine Running...")

while True:

    # keep reading latest locations
    for msg in location_consumer.poll(timeout_ms=200).values():
        for record in msg:
            data = record.value
            latest_users[data["user_id"]] = data

    # check goals
    goals = goal_consumer.poll(timeout_ms=200)

    for msgs in goals.values():
        for g in msgs:

            print("Goal Detected! Sending Coupons...")

            count = 0

            for uid, user in latest_users.items():
                d = distance_km(
                    user["lat"],
                    user["lon"],
                    CENTER_LAT,
                    CENTER_LON
                )

                if d <= RADIUS_KM:
                    coupon = {
                        "user_id": uid,
                        "discount": "50%",
                        "valid_until": (
                            datetime.utcnow() + timedelta(minutes=5)
                        ).isoformat()
                    }

                    producer.send("coupons", coupon)
                    count += 1

            producer.flush()

            print(f"🎟 Sent {count} Coupons")