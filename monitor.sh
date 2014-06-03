#!/bin/bash

set -e
set -x

fswatch -0 . --exclude=.git --exclude=.wake.json --exclude=build/ --exclude=opensource/faye/lib/| while read -d "" event; do
  echo change $event;
  wake;
  cp build/browser/faye-browser.js ../../gitter/webapp/public/repo/faye/faye.js;
done
