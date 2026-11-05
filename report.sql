SELECT u.telegram_id, a.display_name, a.score, a.submitted_at,
       MAX(CASE WHEN json_extract(j.value,'$.number')=1 THEN
           CASE json_extract(j.value,'$.ok') WHEN 1 THEN 'درست' ELSE 'نادرست' END END) AS q1,
       MAX(CASE WHEN json_extract(j.value,'$.number')=2 THEN
           CASE json_extract(j.value,'$.ok') WHEN 1 THEN 'درست' ELSE 'نادرست' END END) AS q2,
       MAX(CASE WHEN json_extract(j.value,'$.number')=3 THEN
           CASE json_extract(j.value,'$.ok') WHEN 1 THEN 'درست' ELSE 'نادرست' END END) AS q3
FROM attempts a JOIN users u ON u.id=a.user_id
JOIN json_each(a.answers) j
WHERE a.round_id='reasoning-01'
GROUP BY a.round_id,a.user_id
ORDER BY a.score DESC,a.submitted_at,a.user_id;
