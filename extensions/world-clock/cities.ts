// Major cities and their IANA time zones. `aliases` are extra names people
// type: abbreviations (NYC, SF), local names (München), airport codes.

export interface City {
  name: string;
  country: string;
  zone: string;
  aliases: string[];
}

// name | country | zone | aliases (comma separated)
const RAW = `
New York|United States|America/New_York|ny,nyc,new york city,manhattan,jfk,east coast,est,edt
Los Angeles|United States|America/Los_Angeles|la,lax,hollywood,pst,pdt,pacific
San Francisco|United States|America/Los_Angeles|sf,sfo,bay area,silicon valley
Seattle|United States|America/Los_Angeles|sea
San Diego|United States|America/Los_Angeles|
Las Vegas|United States|America/Los_Angeles|vegas,las
Portland|United States|America/Los_Angeles|pdx
Chicago|United States|America/Chicago|chi,ord,cst,cdt,central
Houston|United States|America/Chicago|hou
Dallas|United States|America/Chicago|dfw
Austin|United States|America/Chicago|aus
New Orleans|United States|America/Chicago|nola
Minneapolis|United States|America/Chicago|msp
Denver|United States|America/Denver|den,mst,mdt,mountain
Salt Lake City|United States|America/Denver|slc
Phoenix|United States|America/Phoenix|phx,arizona
Boston|United States|America/New_York|bos
Washington|United States|America/New_York|dc,washington dc,was
Miami|United States|America/New_York|mia
Atlanta|United States|America/New_York|atl
Philadelphia|United States|America/New_York|philly,phl
Detroit|United States|America/Detroit|dtw
Pittsburgh|United States|America/New_York|pit
Orlando|United States|America/New_York|mco
Anchorage|United States|America/Anchorage|alaska,akst
Honolulu|United States|Pacific/Honolulu|hawaii,hnl,hst
Toronto|Canada|America/Toronto|yyz
Montreal|Canada|America/Toronto|montréal,yul
Ottawa|Canada|America/Toronto|
Quebec City|Canada|America/Toronto|québec
Vancouver|Canada|America/Vancouver|yvr
Calgary|Canada|America/Edmonton|yyc
Edmonton|Canada|America/Edmonton|
Winnipeg|Canada|America/Winnipeg|
Halifax|Canada|America/Halifax|atlantic
St. John's|Canada|America/St_Johns|newfoundland
Mexico City|Mexico|America/Mexico_City|cdmx,mexico
Guadalajara|Mexico|America/Mexico_City|
Monterrey|Mexico|America/Monterrey|
Cancún|Mexico|America/Cancun|cancun
Tijuana|Mexico|America/Tijuana|
Guatemala City|Guatemala|America/Guatemala|guatemala
San José|Costa Rica|America/Costa_Rica|san jose,costa rica
Panama City|Panama|America/Panama|panama
Havana|Cuba|America/Havana|la habana,cuba
Kingston|Jamaica|America/Jamaica|jamaica
Santo Domingo|Dominican Republic|America/Santo_Domingo|
San Juan|Puerto Rico|America/Puerto_Rico|puerto rico
Bogotá|Colombia|America/Bogota|bogota,colombia
Medellín|Colombia|America/Bogota|medellin
Caracas|Venezuela|America/Caracas|venezuela
Quito|Ecuador|America/Guayaquil|ecuador
Lima|Peru|America/Lima|peru
La Paz|Bolivia|America/La_Paz|bolivia
Santiago|Chile|America/Santiago|chile
Buenos Aires|Argentina|America/Argentina/Buenos_Aires|argentina,bsas
Montevideo|Uruguay|America/Montevideo|uruguay
Asunción|Paraguay|America/Asuncion|asuncion,paraguay
São Paulo|Brazil|America/Sao_Paulo|sao paulo,sp,brazil,brasil
Rio de Janeiro|Brazil|America/Sao_Paulo|rio
Brasília|Brazil|America/Sao_Paulo|brasilia
Manaus|Brazil|America/Manaus|
Recife|Brazil|America/Recife|
London|United Kingdom|Europe/London|ldn,uk,england,lhr,gmt,bst,londres
Manchester|United Kingdom|Europe/London|
Edinburgh|United Kingdom|Europe/London|scotland
Dublin|Ireland|Europe/Dublin|ireland,irlande
Lisbon|Portugal|Europe/Lisbon|lisboa,lisbonne,portugal
Porto|Portugal|Europe/Lisbon|
Madrid|Spain|Europe/Madrid|spain,espagne,españa
Barcelona|Spain|Europe/Madrid|barcelone
Valencia|Spain|Europe/Madrid|
Seville|Spain|Europe/Madrid|sevilla,séville
Canary Islands|Spain|Atlantic/Canary|las palmas,tenerife,canaries
Paris|France|Europe/Paris|france,cdg,cet,cest
Lyon|France|Europe/Paris|
Marseille|France|Europe/Paris|
Toulouse|France|Europe/Paris|
Nice|France|Europe/Paris|
Bordeaux|France|Europe/Paris|
Nantes|France|Europe/Paris|
Lille|France|Europe/Paris|
Strasbourg|France|Europe/Paris|
Brussels|Belgium|Europe/Brussels|bruxelles,belgium,belgique
Amsterdam|Netherlands|Europe/Amsterdam|netherlands,holland,pays-bas,ams
Rotterdam|Netherlands|Europe/Amsterdam|
Luxembourg|Luxembourg|Europe/Luxembourg|
Berlin|Germany|Europe/Berlin|germany,allemagne,deutschland
Munich|Germany|Europe/Berlin|münchen,munchen
Frankfurt|Germany|Europe/Berlin|fra
Hamburg|Germany|Europe/Berlin|
Cologne|Germany|Europe/Berlin|köln,koln
Zurich|Switzerland|Europe/Zurich|zürich,switzerland,suisse,zrh
Geneva|Switzerland|Europe/Zurich|genève,geneve
Vienna|Austria|Europe/Vienna|wien,vienne,austria,autriche
Rome|Italy|Europe/Rome|roma,italy,italie
Milan|Italy|Europe/Rome|milano
Naples|Italy|Europe/Rome|napoli
Venice|Italy|Europe/Rome|venezia,venise
Florence|Italy|Europe/Rome|firenze
Monaco|Monaco|Europe/Monaco|monte carlo
Copenhagen|Denmark|Europe/Copenhagen|københavn,copenhague,denmark
Oslo|Norway|Europe/Oslo|norway,norvège
Stockholm|Sweden|Europe/Stockholm|sweden,suède
Helsinki|Finland|Europe/Helsinki|finland,finlande
Reykjavík|Iceland|Atlantic/Reykjavik|reykjavik,iceland,islande
Warsaw|Poland|Europe/Warsaw|warszawa,varsovie,poland,pologne
Kraków|Poland|Europe/Warsaw|krakow,cracovie
Prague|Czechia|Europe/Prague|praha,czech republic
Budapest|Hungary|Europe/Budapest|hungary,hongrie
Bratislava|Slovakia|Europe/Bratislava|
Ljubljana|Slovenia|Europe/Ljubljana|
Zagreb|Croatia|Europe/Zagreb|croatia
Belgrade|Serbia|Europe/Belgrade|beograd,serbia
Sarajevo|Bosnia and Herzegovina|Europe/Sarajevo|
Bucharest|Romania|Europe/Bucharest|bucurești,bucarest,romania
Sofia|Bulgaria|Europe/Sofia|bulgaria
Athens|Greece|Europe/Athens|athína,athènes,greece,grèce
Istanbul|Turkey|Europe/Istanbul|constantinople,türkiye,turkey,ist
Ankara|Turkey|Europe/Istanbul|
Kyiv|Ukraine|Europe/Kyiv|kiev,ukraine
Minsk|Belarus|Europe/Minsk|
Vilnius|Lithuania|Europe/Vilnius|lithuania
Riga|Latvia|Europe/Riga|latvia
Tallinn|Estonia|Europe/Tallinn|estonia
Chișinău|Moldova|Europe/Chisinau|chisinau
Moscow|Russia|Europe/Moscow|moskva,moscou,msk
Saint Petersburg|Russia|Europe/Moscow|st petersburg,leningrad
Yekaterinburg|Russia|Asia/Yekaterinburg|
Novosibirsk|Russia|Asia/Novosibirsk|
Vladivostok|Russia|Asia/Vladivostok|
Tbilisi|Georgia|Asia/Tbilisi|georgia
Yerevan|Armenia|Asia/Yerevan|armenia
Baku|Azerbaijan|Asia/Baku|azerbaijan
Cairo|Egypt|Africa/Cairo|le caire,egypt,égypte
Alexandria|Egypt|Africa/Cairo|
Casablanca|Morocco|Africa/Casablanca|morocco,maroc
Marrakesh|Morocco|Africa/Casablanca|marrakech
Rabat|Morocco|Africa/Casablanca|
Algiers|Algeria|Africa/Algiers|alger,algeria,algérie
Tunis|Tunisia|Africa/Tunis|tunisia,tunisie
Tripoli|Libya|Africa/Tripoli|libya
Dakar|Senegal|Africa/Dakar|senegal,sénégal
Abidjan|Côte d'Ivoire|Africa/Abidjan|ivory coast
Accra|Ghana|Africa/Accra|ghana
Lagos|Nigeria|Africa/Lagos|nigeria
Abuja|Nigeria|Africa/Lagos|
Kinshasa|DR Congo|Africa/Kinshasa|
Luanda|Angola|Africa/Luanda|angola
Addis Ababa|Ethiopia|Africa/Addis_Ababa|ethiopia
Nairobi|Kenya|Africa/Nairobi|kenya
Dar es Salaam|Tanzania|Africa/Dar_es_Salaam|tanzania
Kampala|Uganda|Africa/Kampala|uganda
Kigali|Rwanda|Africa/Kigali|rwanda
Johannesburg|South Africa|Africa/Johannesburg|joburg,jnb,south africa
Cape Town|South Africa|Africa/Johannesburg|le cap
Antananarivo|Madagascar|Indian/Antananarivo|madagascar
Port Louis|Mauritius|Indian/Mauritius|mauritius,maurice
Saint-Denis|Réunion|Indian/Reunion|reunion,la réunion
Jerusalem|Israel|Asia/Jerusalem|israel
Tel Aviv|Israel|Asia/Jerusalem|tlv
Beirut|Lebanon|Asia/Beirut|beyrouth,lebanon
Amman|Jordan|Asia/Amman|jordan
Damascus|Syria|Asia/Damascus|damas
Baghdad|Iraq|Asia/Baghdad|iraq
Riyadh|Saudi Arabia|Asia/Riyadh|saudi arabia,ksa
Jeddah|Saudi Arabia|Asia/Riyadh|
Kuwait City|Kuwait|Asia/Kuwait|kuwait
Doha|Qatar|Asia/Qatar|qatar
Manama|Bahrain|Asia/Bahrain|bahrain
Dubai|United Arab Emirates|Asia/Dubai|uae,dxb
Abu Dhabi|United Arab Emirates|Asia/Dubai|
Muscat|Oman|Asia/Muscat|oman
Tehran|Iran|Asia/Tehran|téhéran,iran
Kabul|Afghanistan|Asia/Kabul|afghanistan
Karachi|Pakistan|Asia/Karachi|pakistan
Lahore|Pakistan|Asia/Karachi|
Islamabad|Pakistan|Asia/Karachi|
Tashkent|Uzbekistan|Asia/Tashkent|uzbekistan
Almaty|Kazakhstan|Asia/Almaty|kazakhstan
Astana|Kazakhstan|Asia/Almaty|
Mumbai|India|Asia/Kolkata|bombay,india,inde,ist,bom
Delhi|India|Asia/Kolkata|new delhi,del
Bangalore|India|Asia/Kolkata|bengaluru,blr
Chennai|India|Asia/Kolkata|madras
Hyderabad|India|Asia/Kolkata|
Kolkata|India|Asia/Kolkata|calcutta
Pune|India|Asia/Kolkata|
Colombo|Sri Lanka|Asia/Colombo|sri lanka
Kathmandu|Nepal|Asia/Kathmandu|nepal,népal
Dhaka|Bangladesh|Asia/Dhaka|bangladesh
Yangon|Myanmar|Asia/Yangon|rangoon,myanmar
Bangkok|Thailand|Asia/Bangkok|thailand,thaïlande,bkk
Chiang Mai|Thailand|Asia/Bangkok|
Phuket|Thailand|Asia/Bangkok|
Hanoi|Vietnam|Asia/Ho_Chi_Minh|hà nội
Ho Chi Minh City|Vietnam|Asia/Ho_Chi_Minh|saigon,hcmc,vietnam
Phnom Penh|Cambodia|Asia/Phnom_Penh|cambodia
Kuala Lumpur|Malaysia|Asia/Kuala_Lumpur|kl,malaysia
Singapore|Singapore|Asia/Singapore|sg,sin,singapour
Jakarta|Indonesia|Asia/Jakarta|indonesia
Bali|Indonesia|Asia/Makassar|denpasar
Manila|Philippines|Asia/Manila|philippines
Hong Kong|China|Asia/Hong_Kong|hk,hkg
Macau|China|Asia/Macau|macao
Shanghai|China|Asia/Shanghai|china,chine,pvg
Beijing|China|Asia/Shanghai|peking,pékin,pek
Shenzhen|China|Asia/Shanghai|
Guangzhou|China|Asia/Shanghai|canton
Chengdu|China|Asia/Shanghai|
Taipei|Taiwan|Asia/Taipei|taiwan
Seoul|South Korea|Asia/Seoul|korea,corée,icn,kst
Busan|South Korea|Asia/Seoul|
Pyongyang|North Korea|Asia/Pyongyang|
Tokyo|Japan|Asia/Tokyo|japan,japon,jst,tyo,hnd,nrt
Osaka|Japan|Asia/Tokyo|
Kyoto|Japan|Asia/Tokyo|
Sapporo|Japan|Asia/Tokyo|
Ulaanbaatar|Mongolia|Asia/Ulaanbaatar|mongolia
Sydney|Australia|Australia/Sydney|australia,australie,syd,aest
Melbourne|Australia|Australia/Melbourne|mel
Brisbane|Australia|Australia/Brisbane|bne
Perth|Australia|Australia/Perth|per,awst
Adelaide|Australia|Australia/Adelaide|acst
Darwin|Australia|Australia/Darwin|
Hobart|Australia|Australia/Hobart|tasmania
Canberra|Australia|Australia/Sydney|
Auckland|New Zealand|Pacific/Auckland|new zealand,nz,akl,nouvelle-zélande
Wellington|New Zealand|Pacific/Auckland|
Fiji|Fiji|Pacific/Fiji|suva
Nouméa|New Caledonia|Pacific/Noumea|noumea,nouvelle-calédonie
Papeete|French Polynesia|Pacific/Tahiti|tahiti
Guam|Guam|Pacific/Guam|
Apia|Samoa|Pacific/Apia|samoa
UTC|Coordinated Universal Time|UTC|gmt,zulu,utc,z
`;

export const CITIES: City[] = RAW.trim().split("\n").map((line) => {
  const [name, country, zone, aliases] = line.split("|");
  return { name, country, zone, aliases: aliases ? aliases.split(",").map((a) => a.trim()).filter(Boolean) : [] };
});
