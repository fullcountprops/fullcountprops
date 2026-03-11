# Data Directory

## Training Data (Pre-Downloaded)

Statcast and Baseball Savant scraping has been removed from the automated pipeline
for MLB legal compliance. Training data must be pre-downloaded locally.

### How to obtain Statcast training data

1. **Manual download from Baseball Savant:**
   - Visit https://baseballsavant.mlb.com/statcast_search
   - Set your date range and filters
   - Download CSV manually (personal/research use)
   - Save to `data/statcast/` directory

2. **pybaseball (local one-time use only):**
   ```python
   # Run LOCALLY, not in CI/CD pipelines
   import pybaseball as pb
   df = pb.statcast(start_dt='2024-03-28', end_dt='2024-09-29')
   df.to_parquet('data/statcast/statcast_2024.parquet')
   ```
   Note: Do NOT run pybaseball in automated pipelines or GitHub Actions.

3. **Licensed API providers:**
   - BallDontLie: https://mlb.balldontlie.io
   - MySportsFeeds: https://www.mysportsfeeds.com
   - Rolling Insights: https://rollinginsights.com

### Directory structure

```
data/
  games/          # Game-level data
  players/        # Player roster data
  statcast/       # Pre-downloaded Statcast parquet files (gitignored)
  training/       # Processed training datasets (gitignored)
```

### Important

- Large data files (.parquet, .csv) should be gitignored
- Training data is NOT committed to the repository
- Each developer downloads their own copy locally
- The `build_training_dataset.py` script processes local Statcast files
