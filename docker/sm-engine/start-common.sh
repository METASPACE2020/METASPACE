#!/usr/bin/env bash

wait_for() {
  if ! $1; then
    echo "Waiting for $2"
    sleep 5
    until $1; do
        printf '.'
        sleep 1
    done
  fi
  echo "$2 is up"
}

if [ "$SM_DOCKER_ENV" = "development" ]; then
  cd /opt/dev/metaspace/metaspace/engine
else
  cd /opt/metaspace/metaspace/engine
fi

#pip install -qr requirements.txt  # doesn't work with docker-compose service 'user' option

wait_for "nc -z postgres 5432" "Postgres"
wait_for "nc -z rabbitmq 5672" "RabbitMQ"

export PYTHONUNBUFFERED=1 # Fix issue with Python sometimes mysteriously buffering its output indefinitely
