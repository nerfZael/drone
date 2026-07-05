UPDATE assistant_threads
SET capabilities_json = CASE
  WHEN json_valid(capabilities_json) THEN json_remove(capabilities_json, '$.approvals')
  ELSE '{"artifacts":true,"speech":true,"externalCalls":true,"futureIntegrations":false}'
END;
