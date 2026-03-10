const fs = require('fs');
const https = require('https');

const nums = JSON.parse(fs.readFileSync('ops/botpool/sms_numbers.json', 'utf8'));
let done = 0;
const total = nums.length;

function rejectNumber(n) {
    const url = `https://api.sms-man.com/control/set-status?token=1MnU16axIhaoYB354wnZZ7ouRx3Cy9Lv&request_id=${n.request_id}&status=reject`;
    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            console.log(`${n.phone} ${n.request_id} ${data.trim()}`);
            done++;
            if (done === total) {
                console.log('Done:', done);
            }
        });
    }).on('error', (e) => {
        console.error('Error for', n.request_id, e.message);
        done++;
        if (done === total) {
            console.log('Done:', done);
        }
    });
}

nums.forEach(rejectNumber);
