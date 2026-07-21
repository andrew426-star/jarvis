# J.A.R.V.I.S.

Andrew's personal AI chief-of-staff. Milestone 1: a working `/invoke`
endpoint, Groq as the brain, Supabase persistent memory, and two tools
(`database_agent`, `web_research`). No voice, no Redis/Pinecone, no frontend
yet — those are later milestones.

## Run locally

```
pip install -r requirements.txt
cp .env.example .env   # fill in real values
uvicorn app.main:app --reload --port 8000
```

## Try it

```
curl -X POST localhost:8000/invoke -H "Content-Type: application/json" \
  -d '{"message": "What can you do right now?"}'
```
