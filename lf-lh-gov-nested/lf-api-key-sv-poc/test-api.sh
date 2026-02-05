#!/bin/bash

API_KEY="mcHHPPAa2t3I5Ee9N9mge3wQF4TdNGK0203sJr5j"
ENDPOINT="https://9zd4v83if8.execute-api.ap-southeast-2.amazonaws.com/staging/query"

curl -X POST "$ENDPOINT" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "database": "lf-lh-silver-db-o-sp7-dev",
    "query": "SELECT * FROM member_data LIMIT 3"
  }'

echo ""
