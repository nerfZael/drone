// Shared by the worker and pending-delivery presentation. Uses aliases s and d.
export const subscriptionRunCapacitySql = `((
              SELECT COUNT(DISTINCT COALESCE((
                SELECT canonical_prompt_id FROM prompt_submission_receipts r
                WHERE r.drone_id = b.subscriber_drone_id
                  AND r.idempotency_key = 'subscription-batch:' || b.id
              ), b.prompt_id)) FROM subscription_batches b
              WHERE b.subscriber_chat_id = s.subscriber_chat_id
                AND b.state = 'delivered' AND b.created_at >= ?
            ) < ? OR EXISTS (
              SELECT 1 FROM prompts p
              WHERE p.drone_id = s.subscriber_drone_id AND p.chat_name = s.subscriber_chat_name
                AND p.state = 'queued' AND p.attempt_count = 0
                AND json_type(p.payload_json, '$.eventBundle') = 'object'
                AND COALESCE(json_extract(p.payload_json, '$.eventBundle.sealed'), 0) = 0
                AND json_array_length(p.payload_json, '$.eventBundle.events') <
                  MIN(COALESCE(json_extract(p.payload_json, '$.eventBundle.maxEvents'), 100), ?)
                AND COALESCE(json_extract(p.payload_json, '$.deliveryMode'), 'queue') = COALESCE(
                  (SELECT value FROM json_each(?) WHERE key = (SELECT event_type FROM resource_events WHERE id = d.event_id)), ?
                )
            ))`;
