"""
pipeline/fetch_weather.py

Fetch current weather conditions for MLB game venues and compute a
K-rate impact multiplier for the BaselineMLB Monte Carlo simulator.

Uses the OpenWeatherMap free-tier current weather API.
Returns a neutral multiplier (1.0) gracefully on any API failure.
"""

import argparse
import logging
import os
import time
from datetime import date
from typing import Optional

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Stadium coordinates -- all 30 MLB venues (lat, lon)
# ---------------------------------------------------------------------------
STADIUM_COORDS: dict[str, tuple[float, float]] = {
    # American League East
    "BAL": (39.2838, -76.6215),   # Camden Yards
    "BOS": (42.3467, -71.0972),   # Fenway Park
    "NYY": (40.8296, -73.9262),   # Yankee Stadium
    "TB":  (27.7683, -82.6534),   # Tropicana Field (dome -- weather neutral)
    "TOR": (43.6414, -79.3894),   # Rogers Centre (dome)
    # American League Central
    "CWS": (41.8300, -87.6339),   # Guaranteed Rate Field
    "CLE": (41.4959, -81.6852),   # Progressive Field
    "DET": (42.3390, -83.0485),   # Comerica Park
    "KC":  (39.0517, -94.4803),   # Kauffman Stadium
    "MIN": (44.9817, -93.2777),   # Target Field
    # American League West
    "HOU": (29.7573, -95.3555),   # Minute Maid Park (retractable)
    "LAA": (33.8003, -117.8827),  # Angel Stadium
    "OAK": (37.7516, -122.2005),  # Oakland Coliseum (or future venue)
    "SEA": (47.5913, -122.3325),  # T-Mobile Park (retractable)
    "TEX": (32.7473, -97.0832),   # Globe Life Field (dome)
    # National League East
    "ATL": (33.8908, -84.4679),   # Truist Park
    "MIA": (25.7781, -80.2197),   # loanDepot Park (retractable)
    "NYM": (40.7571, -73.8458),   # Citi Field
    "PHI": (39.9057, -75.1665),   # Citizens Bank Park
    "WSH": (38.8730, -77.0074),   # Nationals Park
    # National League Central
    "CHC": (41.9484, -87.6553),   # Wrigley Field
    "CIN": (39.0979, -84.5074),   # Great American Ball Park
    "MIL": (43.0280, -87.9712),   # American Family Field (retractable)
    "PIT": (40.4469, -80.0057),   # PNC Park
    "STL": (38.6226, -90.1928),   # Busch Stadium
    # National League West
    "ARI": (33.4455, -112.0667),  # Chase Field (retractable)
    "COL": (39.7559, -104.9942),  # Coors Field
    "LAD": (34.0739, -118.2400),  # Dodger Stadium
    "SD":  (32.7076, -117.1570),  # Petco Park
    "SF":  (37.7786, -122.3893),  # Oracle Park
}

# Dome / fully enclosed stadiums -- weather doesn't affect play
DOME_STADIUMS: set[str] = {"TB", "TOR", "HOU", "TEX", "MIA", "MIL", "ARI", "SEA"}

OWM_BASE_URL = "https://api.openweathermap.org/data/2.5/weather"

MAX_RETRIES   = 3
RETRY_BACKOFF = [2, 5, 10]


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------
def _get_with_retry(url: str, params: dict, retries: int = MAX_RETRIES) -> Optional[dict]:
    """
    Perform an HTTP GET with retry and exponential backoff.

    Args:
        url:     Request URL.
        params:  Query parameters dict.
        retries: Maximum attempts before giving up.

    Returns:
        Parsed JSON response dict, or None on persistent failure.
    """
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
            logger.warning(
                "OWM request failed (attempt %d/%d): %s -- retrying in %ds",
                attempt + 1, retries, exc, wait,
            )
            time.sleep(wait)
    return None


# ---------------------------------------------------------------------------
# Weather fetch
# ---------------------------------------------------------------------------
def fetch_weather_for_venue(
    team_abbr: str,
    api_key: str,
) -> dict:
    """
    Fetch current weather for a given MLB team's home stadium.

    Returns neutral values if the stadium is a dome or if the API call fails.

    Args:
        team_abbr: Three-letter MLB team abbreviation (e.g. "NYY").
        api_key:   OpenWeatherMap API key.

    Returns:
        Dict with keys: team, temp_f, wind_speed_mph, wind_deg,
        humidity_pct, description, is_dome, k_rate_multiplier.
    """
    neutral = {
        "team": team_abbr,
        "temp_f": None,
        "wind_speed_mph": None,
        "wind_deg": None,
        "humidity_pct": None,
        "description": "unavailable",
        "is_dome": team_abbr in DOME_STADIUMS,
        "k_rate_multiplier": 1.0,
    }

    if team_abbr in DOME_STADIUMS:
        logger.info("%s plays in a dome -- weather neutral (multiplier=1.0)", team_abbr)
        neutral["description"] = "dome/retractable roof -- weather neutral"
        return neutral

    coords = STADIUM_COORDS.get(team_abbr)
    if not coords:
        logger.warning("No coordinates found for team %s -- returning neutral", team_abbr)
        return neutral

    lat, lon = coords
    params = {
        "lat":   lat,
        "lon":   lon,
        "appid": api_key,
        "units": "imperial",  # Fahrenheit, mph
    }

    data = _get_with_retry(OWM_BASE_URL, params)
    if not data:
        logger.warning("Weather API unavailable for %s -- returning neutral multiplier", team_abbr)
        return neutral

    try:
        temp_f     = float(data["main"]["temp"])
        wind_speed = float(data["wind"].get("speed", 0.0))
        wind_deg   = float(data["wind"].get("deg", 0.0))
        humidity   = float(data["main"].get("humidity", 50.0))
        desc       = data["weather"][0]["description"] if data.get("weather") else ""

        multiplier = _compute_k_multiplier(temp_f, wind_speed, wind_deg, humidity)

        logger.info(
            "%s weather: %.1f F  wind=%.1f mph @ %.0f deg  humidity=%d%%  desc='%s'  K-mult=%.3f",
            team_abbr, temp_f, wind_speed, wind_deg, humidity, desc, multiplier,
        )

        return {
            "team": team_abbr,
            "temp_f": round(temp_f, 1),
            "wind_speed_mph": round(wind_speed, 1),
            "wind_deg": round(wind_deg, 1),
            "humidity_pct": int(humidity),
            "description": desc,
            "is_dome": False,
            "k_rate_multiplier": round(multiplier, 4),
        }

    except (KeyError, TypeError, ValueError) as exc:
        logger.warning("Unexpected OWM response structure for %s: %s", team_abbr, exc)
        return neutral


# ---------------------------------------------------------------------------
# K-rate multiplier computation
# ---------------------------------------------------------------------------
def _is_wind_outward(wind_deg: float, stadium_orientation: Optional[float] = None) -> bool:
    """
    Heuristic: treat wind blowing from home plate toward the outfield as 'outward'.

    Without per-stadium orientation data we approximate based on the wind
    direction being roughly northward (270-90 deg) since most stadiums orient
    home plate toward the south. Override by supplying stadium_orientation.

    Args:
        wind_deg:            Wind direction in meteorological degrees (0=N, 90=E...).
        stadium_orientation: Optional compass bearing from home to CF for the stadium.

    Returns:
        True if wind is blowing outward (toward CF), False otherwise.
    """
    if stadium_orientation is not None:
        # Difference between wind direction and CF bearing -- outward if < 90 deg
        diff = abs((wind_deg - stadium_orientation + 360) % 360)
        return diff < 90
    # Default heuristic: wind from S (135-225 deg) blows toward outfield for most parks
    return 135 <= wind_deg <= 225


def _compute_k_multiplier(
    temp_f: float,
    wind_speed_mph: float,
    wind_deg: float,
    humidity_pct: float,
) -> float:
    """
    Compute a K-rate multiplier based on environmental conditions.

    Adjustments (additive, then clamped to [0.80, 1.25]):

        Temperature:
          - Below 55 F  -> -3 pp  (cold = fewer Ks)
          - Above 85 F  -> +2 pp  (heat = more Ks / fatigue)

        Wind (>15 mph):
          - Blowing outward -> -5 pp  (ball carries, batters swing more freely)
          - Blowing inward  -> +3 pp  (ball dies, more Ks)

        Humidity:
          - Above 80%  -> -1 pp  (heavier air, ball carries less -- inconsistent effect)

    Args:
        temp_f:         Temperature in Fahrenheit.
        wind_speed_mph: Wind speed in miles per hour.
        wind_deg:       Wind direction in meteorological degrees.
        humidity_pct:   Relative humidity as a percentage (0-100).

    Returns:
        K-rate multiplier as a float (base 1.0).
    """
    adjustment = 0.0

    # Temperature effect
    if temp_f < 55:
        adjustment -= 0.03
    elif temp_f > 85:
        adjustment += 0.02

    # Wind effect
    if wind_speed_mph > 15:
        if _is_wind_outward(wind_deg):
            adjustment -= 0.05
        else:
            adjustment += 0.03

    # Humidity effect
    if humidity_pct > 80:
        adjustment -= 0.01

    # Clamp to reasonable bounds
    multiplier = max(0.80, min(1.25, 1.0 + adjustment))
    return multiplier


# ---------------------------------------------------------------------------
# Batch fetch for a full game day
# ---------------------------------------------------------------------------
def fetch_all_venue_weather(
    home_teams: list[str],
    api_key: str,
    delay: float = 0.5,
) -> dict[str, dict]:
    """
    Fetch weather for all home teams playing on a given day.

    Args:
        home_teams: List of team abbreviations for home teams.
        api_key:    OpenWeatherMap API key.
        delay:      Seconds to wait between API calls (rate limiting).

    Returns:
        Dict mapping team abbreviation -> weather dict.
    """
    results: dict[str, dict] = {}
    for team in home_teams:
        results[team] = fetch_weather_for_venue(team, api_key)
        time.sleep(delay)
    return results


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
def main() -> None:
    """CLI entry point: fetch weather for all MLB home stadiums on a given date."""
    parser = argparse.ArgumentParser(
        description="Fetch weather data for MLB game venues and compute K-rate multipliers."
    )
    parser.add_argument(
        "--date",
        default=date.today().strftime("%Y-%m-%d"),
        help="Game date (YYYY-MM-DD, default: today) -- used for display only; fetches current wx",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("OPENWEATHER_API_KEY", ""),
        help="OpenWeatherMap API key (or set OPENWEATHER_API_KEY env var)",
    )
    parser.add_argument(
        "--teams",
        nargs="+",
        default=list(STADIUM_COORDS.keys()),
        help="Space-separated list of home team abbreviations to fetch (default: all 30)",
    )
    args = parser.parse_args()

    if not args.api_key:
        logger.warning(
            "No OpenWeatherMap API key provided. "
            "Set --api-key or OPENWEATHER_API_KEY env var. "
            "All venues will return neutral multiplier (1.0)."
        )
        # Still produce neutral output for all requested teams
        for team in args.teams:
            logger.info("%-3s  K-rate multiplier: 1.0000  (no API key)", team)
        return

    logger.info("Fetching weather for %d venue(s) on %s", len(args.teams), args.date)
    weather_map = fetch_all_venue_weather(args.teams, args.api_key)

    # Print summary table
    logger.info("%-5s  %-6s  %-8s  %-6s  %-8s  %-12s  %s",
                "TEAM", "TEMP_F", "WIND_MPH", "WIND_DEG", "HUMIDITY", "K_MULTIPLIER", "DESC")
    for team, wx in sorted(weather_map.items()):
        logger.info(
            "%-5s  %-6s  %-8s  %-6s  %-8s  %-12.4f  %s",
            wx["team"],
            f"{wx['temp_f']} F" if wx["temp_f"] is not None else "N/A",
            f"{wx['wind_speed_mph']}" if wx["wind_speed_mph"] is not None else "N/A",
            f"{wx['wind_deg']}" if wx["wind_deg"] is not None else "N/A",
            f"{wx['humidity_pct']}%" if wx["humidity_pct"] is not None else "N/A",
            wx["k_rate_multiplier"],
            wx["description"],
        )


if __name__ == "__main__":
    main()
