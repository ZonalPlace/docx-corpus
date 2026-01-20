#!/usr/bin/env python3
"""Generate embeddings for document text. Outputs JSON to stdout."""
import json
import sys
import argparse
import os


def get_embedder(model_name: str):
    """Return an embedding function for the given model."""
    if model_name == "voyage-lite":
        import voyageai

        api_key = os.environ.get("VOYAGE_API_KEY")
        if not api_key:
            raise ValueError("VOYAGE_API_KEY environment variable required for voyage-lite model")
        client = voyageai.Client(api_key=api_key)

        def embed_voyage(texts: list[str]) -> list[list[float]]:
            result = client.embed(texts, model="voyage-3.5-lite")
            return result.embeddings

        return embed_voyage, 1024  # voyage-3.5-lite outputs 1024 dims

    else:
        from sentence_transformers import SentenceTransformer

        model_map = {
            "minilm": "all-MiniLM-L6-v2",
            "bge-m3": "BAAI/bge-m3",
        }
        model_id = model_map.get(model_name, model_name)
        model = SentenceTransformer(model_id)
        dims = model.get_sentence_embedding_dimension()

        def embed_local(texts: list[str]) -> list[list[float]]:
            embeddings = model.encode(texts, convert_to_numpy=True)
            return embeddings.tolist()

        return embed_local, dims


def main():
    parser = argparse.ArgumentParser(description="Generate embeddings for text")
    parser.add_argument("--model", default="minilm", help="Model to use: minilm, bge-m3, voyage-lite")
    parser.add_argument("--batch", action="store_true", help="Batch mode: read JSONL from stdin")
    args = parser.parse_args()

    try:
        embedder, dimensions = get_embedder(args.model)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

    if args.batch:
        # Batch mode: read {"id": "...", "text": "..."} lines from stdin
        docs = []
        for line in sys.stdin:
            line = line.strip()
            if line:
                docs.append(json.loads(line))

        if not docs:
            sys.exit(0)

        texts = [d["text"] for d in docs]

        try:
            embeddings = embedder(texts)
        except Exception as e:
            print(json.dumps({"error": str(e)}), file=sys.stderr)
            sys.exit(1)

        for doc, emb in zip(docs, embeddings):
            result = {
                "id": doc["id"],
                "embedding": emb,
                "dimensions": dimensions,
            }
            print(json.dumps(result))
    else:
        # Single doc mode: text from stdin
        text = sys.stdin.read().strip()
        if not text:
            print(json.dumps({"error": "No text provided"}), file=sys.stderr)
            sys.exit(1)

        try:
            embeddings = embedder([text])
        except Exception as e:
            print(json.dumps({"error": str(e)}), file=sys.stderr)
            sys.exit(1)

        result = {
            "embedding": embeddings[0],
            "dimensions": dimensions,
        }
        print(json.dumps(result))


if __name__ == "__main__":
    main()
