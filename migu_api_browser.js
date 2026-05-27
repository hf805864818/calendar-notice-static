/**
 * 咪咕音乐API - 浏览器版
 * 基于 http://music.haitangw.net/cqapi/xiaomi.js 反解实现
 */

const MIGU_API = {
    // 咪咕音乐搜索API
    search: async (keyword, page = 1) => {
        const params = new URLSearchParams({
            keyword: keyword,
            type: '2', // 2=音乐搜索
            pgc: page,
            rows: '20'
        });

        const headers = {
            'Accept': 'application/json, text/plain, */*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Connection': 'keep-alive',
            'Content-Type': 'application/json;charset=UTF-8',
            'Host': 'm.music.migu.cn',
            'Referer': `https://m.music.migu.cn/v3/search?keyword=${encodeURIComponent(keyword)}`,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
            'X-Requested-With': 'XMLHttpRequest'
        };

        try {
            const response = await fetch(`https://m.music.migu.cn/v3/search?${params.toString()}`, {
                method: 'GET',
                headers: headers,
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('咪咕搜索失败:', error);
            throw error;
        }
    },

    // 解析咪咕歌曲URL
    resolveSong: async (song) => {
        // 咪咕返回的数据中通常包含多种格式
        // 优先级: flac > 320kmp3 > 128kmp3
        const formats = ['flac', '320kmp3', '128kmp3', 'mp3'];

        for (const format of formats) {
            if (song[format] && typeof song[format] === 'string' && song[format].startsWith('http')) {
                return song[format];
            }
        }

        throw new Error('无可用播放链接');
    },

    // 获取歌词
    getLyric: async (song) => {
        // 检查原始数据中是否有歌词
        if (song.lrc && typeof song.lrc === 'string') {
            return song.lrc;
        }
        if (song.lyricLrc && typeof song.lyricLrc === 'string') {
            return song.lyricLrc;
        }

        // 如果没有歌词，返回歌曲信息作为占位
        return `${song.title || song.songName} - ${song.artist || song.singer}`;
    },

    // 标准化咪咕搜索结果
    normalizeSong: (item) => {
        return {
            id: item.id,
            name: item.songName || item.title,
            artist: item.singer || item.singerName || item.artist,
            album: item.album || item.albumName,
            pic: item.artwork || item.albumPic || item.img || '',
            url: '', // 稍后解析
            lrc: item.lrc || item.lyricLrc || '',
            copyrightId: item.copyrightId || '',
            singerId: item.singerId || '',
            source: 'mg',
            sourceName: '咪咕',
            raw: item // 保留原始数据
        };
    }
};

// 导出为全局变量（浏览器环境）
if (typeof window !== 'undefined') {
    window.MIGU_API = MIGU_API;
}

// Node.js 环境导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MIGU_API;
}