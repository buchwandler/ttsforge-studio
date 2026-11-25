# TTSForge Studio `/api/v1` contract used by this MVP

This is the frontend contract expected by the source in this repository.

The authoritative implementation should live in TTSForge.

## Authentication

Every endpoint except `/api/v1/health` is expected to accept:

```http
Authorization: Bearer <token>
```

## Endpoints used now

```text
POST /api/v1/sources/inspect
POST /api/v1/sources/import

GET  /api/v1/catalog/engines
GET  /api/v1/catalog/targets
GET  /api/v1/catalog/voices
GET  /api/v1/resources/spacy

POST /api/v1/jobs
GET  /api/v1/jobs/{id}
POST /api/v1/jobs/{id}/cancel
```

### Inspect source

```json
{
  "path": "/path/book.epub"
}
```

Response:

```json
{
  "source": "/path/book.epub",
  "kind": "book",
  "title": "Book title",
  "author": "Author",
  "language": "en-US",
  "chapters": [
    {
      "number": 1,
      "title": "Chapter One",
      "source_id": "chapter-1",
      "char_count": 10000
    }
  ]
}
```

### Import source

Multipart field:

```text
file
```

Response:

```json
{
  "source_id": "uuid",
  "path": "/server/state/imports/uuid/book.epub",
  "inspection": {
    "...": "same BookInspection shape"
  }
}
```

### Start job

```json
{
  "request": {
    "source": "/path/book.epub",
    "chapters": "all",
    "output": "/path/book.m4b",
    "language": "en-US",
    "engine": "kokoro",
    "target": "target-id",
    "voice": "voice-id",
    "engine_options": {},
    "spacy": "lg",
    "pause_timing": "engaging",
    "title": "Book title",
    "author": "Author",
    "offline": false,
    "refresh": false,
    "replace_output": false,
    "fresh": false,
    "new_variant": false
  },
  "explicit_fields": [
    "chapters",
    "output",
    "language",
    "engine",
    "target",
    "voice",
    "spacy",
    "pause_timing",
    "title",
    "author"
  ]
}
```

### Job state

```json
{
  "id": "uuid",
  "state": "running",
  "progress": {
    "stage": "render",
    "kind": "stage.progress",
    "message": "Rendering speech",
    "package": "voicerender",
    "selector": "5-17",
    "current": 27,
    "total": 91,
    "elapsed_seconds": 833.2,
    "details": {
      "chapter_number": 8,
      "chapter_title": "Chapter Eight"
    }
  },
  "result": null,
  "error": null
}
```

Terminal states:

```text
completed
failed
cancelled
```

The frontend currently polls every 750 ms.

A future release can switch to event streaming without changing `ApplicationEvent`.
