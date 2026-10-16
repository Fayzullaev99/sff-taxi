-- A car's colour was free text in Uzbek ("oq", "Qora"), read as such by Russian apps. The
-- API now keeps a code from a fixed list (src/lib/vehicle-colour.ts) and names it in each
-- language. Rows written before are mapped where the text is one of the list's colours in
-- either language (case, spaces and the apostrophe variants of Uzbek keyboards apart); any
-- other text stays as the driver wrote it. Ride and trip snapshots (rides.vehicle,
-- intercity_trips.vehicle) are left alone: the API maps those on the way out.
WITH names(code, name) AS (
  VALUES
    ('white', 'oq'), ('white', 'белый'), ('white', 'белая'), ('white', 'white'),
    ('black', 'qora'), ('black', 'qara'), ('black', 'чёрный'), ('black', 'черный'),
    ('black', 'черная'), ('black', 'чёрная'), ('black', 'black'),
    ('silver', 'kumush'), ('silver', 'kumushrang'), ('silver', 'kumush rang'),
    ('silver', 'серебристый'), ('silver', 'серебристая'), ('silver', 'серебряный'),
    ('silver', 'серебро'), ('silver', 'silver'),
    ('grey', 'kulrang'), ('grey', 'kul rang'), ('grey', 'серый'), ('grey', 'серая'),
    ('grey', 'gray'), ('grey', 'grey'),
    ('blue', 'ko''k'), ('blue', 'kok'), ('blue', 'синий'), ('blue', 'синяя'), ('blue', 'blue'),
    ('dark_blue', 'to''q ko''k'), ('dark_blue', 'toq kok'), ('dark_blue', 'тёмно-синий'),
    ('dark_blue', 'темно-синий'), ('dark_blue', 'тёмно синий'), ('dark_blue', 'темно синий'),
    ('dark_blue', 'dark blue'), ('dark_blue', 'navy'),
    ('light_blue', 'havorang'), ('light_blue', 'havo rang'), ('light_blue', 'moviy'),
    ('light_blue', 'голубой'), ('light_blue', 'голубая'), ('light_blue', 'light blue'),
    ('red', 'qizil'), ('red', 'красный'), ('red', 'красная'), ('red', 'red'),
    ('dark_red', 'to''q qizil'), ('dark_red', 'toq qizil'), ('dark_red', 'bordo'),
    ('dark_red', 'бордовый'), ('dark_red', 'бордовая'), ('dark_red', 'бордо'),
    ('dark_red', 'вишнёвый'), ('dark_red', 'вишневый'), ('dark_red', 'dark red'),
    ('green', 'yashil'), ('green', 'зелёный'), ('green', 'зеленый'), ('green', 'зелёная'),
    ('green', 'зеленая'), ('green', 'green'),
    ('yellow', 'sariq'), ('yellow', 'жёлтый'), ('yellow', 'желтый'), ('yellow', 'жёлтая'),
    ('yellow', 'желтая'), ('yellow', 'yellow'),
    ('orange', 'to''q sariq'), ('orange', 'toq sariq'), ('orange', 'apelsin'),
    ('orange', 'apelsinrang'), ('orange', 'оранжевый'), ('orange', 'оранжевая'),
    ('orange', 'orange'),
    ('brown', 'jigarrang'), ('brown', 'jigar rang'), ('brown', 'коричневый'),
    ('brown', 'коричневая'), ('brown', 'brown'),
    ('beige', 'bej'), ('beige', 'bejrang'), ('beige', 'бежевый'), ('beige', 'бежевая'),
    ('beige', 'beige'),
    ('purple', 'binafsha'), ('purple', 'binafsharang'), ('purple', 'binafsha rang'),
    ('purple', 'фиолетовый'), ('purple', 'фиолетовая'), ('purple', 'сиреневый'),
    ('purple', 'purple'),
    ('gold', 'tillarang'), ('gold', 'tilla rang'), ('gold', 'oltin'), ('gold', 'oltinrang'),
    ('gold', 'золотой'), ('gold', 'золотистый'), ('gold', 'золотистая'), ('gold', 'gold')
),
-- the same normalisation as colourCode(), applied to both sides: lower case, one space, a
-- plain apostrophe for every variant, a trailing " rang" dropped ("kul rang" -> "kul")
known AS (
  SELECT code,
         regexp_replace(
           btrim(regexp_replace(translate(lower(name), '‘’ʻʼ`´', repeat('''', 6)), '\s+', ' ', 'g')),
           ' rang$', '') AS name
  FROM names
),
normalized AS (
  SELECT driver_id,
         regexp_replace(
           btrim(regexp_replace(translate(lower(colour), '‘’ʻʼ`´', repeat('''', 6)), '\s+', ' ', 'g')),
           ' rang$', '') AS name
  FROM vehicles
)
UPDATE vehicles v
   SET colour = known.code,
       updated_at = now()
  FROM normalized n
  JOIN known ON known.name = n.name
 WHERE v.driver_id = n.driver_id
   AND v.colour <> known.code;
