function TimeCode() {
  this.time = new Uint8Array(4) ;
  this.ubits= new Uint8Array(4) ;
  this.qse       = -1 ; // "Quanta Since Epoch", or frames since midnight
  this.df_flag   =  0 ;
  this.max_frame = -1 ; // 2nd check for frame rate computation
  this.rate      = -1 ;
}

TimeCode.prototype.getRate = function() {
  if( this.rate < 0 ) {
    return (this.max_frame + 1) ;
  } else {
    return this.rate ;
  }
} ;

TimeCode.prototype.computeQSE = function() {
  var acc = 0 ;
  
  acc += this.time[0] ; // Hours
  acc *= 60 ;
  acc += this.time[1] ; // mins
  acc *= 60 ;
  acc += this.time[2] ; // secs
  acc *= this.getRate() ;
  acc += this.time[3] ; // frames
  
  this.qse = acc ;
} ;

TimeCode.prototype.computeArray = function() {
  // max QSE is ~2.5e6, this computaton needs to be done in 32-Bit int
  var hour, mins, secs, frms, fps ;

  fps = this.getRate() ;
  
  // div and mod to get HH:MM:SS:FF
  secs = this.qse / fps ;
  mins = secs / 60 ;
  hour = mins / 60 ;
  
  frms = this.qse % fps ;
  secs = secs % 60 ;
  mins = mins % 60 ;
  hour = hour % 24 ;
  
  // set Array representation
  this.time[0] = hour ;
  this.time[1] = mins ;
  this.time[2] = secs ;
  this.time[3] = frms ;
} ;

TimeCode.prototype.inc = function( val ) {
  if( val === undefined ){
    val = 1 ;
  }
  this.qse += val ;
} ;

TimeCode.prototype.setFromArray = function( new_time ) {
  this.time = new_time ;
  this.computeQSE() ;
} ;

TimeCode.prototype.setFromBF = function( bf ) {
  var FrameU, FrameT, SecU, SecT, MinU, MinT, HrU, HrT, drop ;
  // First Short
  FrameU = (bf[0] & 0xF000) >> 12 ;
  FrameT = (bf[0] & 0x00C0) >>  6 ;
  drop   = (bf[0] & 0x0020) >>  5 ;
  if( drop != this.df_flag ) {
    // register event to flag flag?
    this.df_flag = drop ;
  }
  this.ubits[0]  = (bf[0] & 0x0F00) >> 4 ;
  this.ubits[0] |= (bf[0] & 0x000F) ;
  this.time[3]   = (10*FrameT) + FrameU ;
  this.max_frame = Math.max( this.time[3], this.max_frame ) ;
  
  // 2nd Short
  SecU = (bf[1] & 0xF000) >> 12 ;
  SecT = (bf[1] & 0x00E0) >>  5 ;
  this.ubits[1]  = (bf[1] & 0x0F00) >> 4 ;
  this.ubits[1] |= (bf[1] & 0x000F) ;
  this.time[2]   = (10*SecT) + SecU ;
  
  // 3rd Short
  MinU = (bf[2] & 0xF000) >> 12 ;
  MinT = (bf[2] & 0x00E0) >>  5 ;
  this.ubits[2]  = (bf[2] & 0x0F00) >> 4 ;
  this.ubits[2] |= (bf[2] & 0x000F) ;
  this.time[1]   = (10*MinT) + MinU ;
  
  // 4th Short
  HrU = (bf[3] & 0xF000) >> 12 ;
  HrT = (bf[3] & 0x00C0) >>  6 ;
  this.ubits[3]  = (bf[3] & 0x0F00) >> 4 ;
  this.ubits[3] |= (bf[3] & 0x000F) ;
  this.time[0]   = (10*HrT) + HrU ;
  
  // compute QSE
  this.computeQSE() ;
} ;

TimeCode.prototype.setRateFromBF = function( bit_period ) {
  //
  var periods = [ 0.033333, 0.033366, 0.04, 0.0416666666, 0.04170833 ] ;
  var rates   = [       30,       29,   25,           24,         23 ] ;
  var frame_period = bit_period * 80.0 ;
  var found = -1 ;
  for( var i = 0; i < 5; i++ ) {
    if( frame_period < periods[ i ] ) {
      found = rates[i] ;
      break ;
    }
  }
  if( found != -1 ) {
    this.rate = found ;
  }
} ;

TimeCode.prototype.display = function( mode ) {
  // MODE: 0 = TC, 1 = full data, 2 = QSE
  if( mode === undefined ) {
    mode = 1 ;
  }
  if( mode > 1 ) {
    print( this.qse ) ;
    return ;
  }
  // TODO: zero pad these values
  var tcstr = this.time[0].toString() + ":" +
              this.time[1].toString() + ":" +
              this.time[2].toString() + ((this.df_flag) ? ";" : ":") +
              this.time[3].toString() ;
  if( mode == 1 ) {
    print( tcstr ) ;
  } else {
    print( "Timecode :" + tcstr ) ;
    print( "Userbits :" + this.ubits[0].toString(16) +
          this.ubits[1].toString(16) +
          this.ubits[2].toString(16) +
          this.ubits[3].toString(16) ) ;
  }
} ;



function LTCDecoder() {
  this.SYNC_FLAG   = 0x3FFD ;

  this.bit_field   = new Uint16Array(5) ;
  this.frame_count = 0 ;

  this.syncEvent = function(){} ; // lambda tastic
}

LTCDecoder.prototype.appendBit = function( bit ) {
  var next_add = bit ;
  var this_carry = 0 ;
  // shift bits logical left, add the carry
  for( var i = 4; i>=0; i-- ) {
    // get MSB to carry
    // this_carry = (this.bit_field[i] & 0x8000) >> 15 ;
    this_carry = (this.bit_field[i] > 0x8000) ;
    // shift + add
    this.bit_field[i]  = this.bit_field[i] << 1 ;
    this.bit_field[i] |= next_add ;
    // get next carry
    next_add = this_carry ;
  } // for each element to be shifted
  
  // if in sync, trigger event(s)
  if( this.bit_field[4] == this.SYNC_FLAG ) {
    ++this.frame_count ;
    this.syncEvent() ;
  }
} ;

LTCDecoder.prototype.IsSyncPoint = function() {
  return (this.bit_field[4] == this.SYNC_FLAG) ;
} ;


GEN = {} ; // testing only

GEN.bit_field = new Uint16Array(5) ;

GEN.compByteParity = function( char ) {
  // Hey, I remember this from school!
  char ^= char >> 4 ;
  char ^= char >> 2 ;
  char ^= char >> 1 ;
  return  char  & 1 ;
} ;

GEN.makeBF = function( time, ubits, dff ) {
  var FrameU, FrameT, SecU, SecT, MinU, MinT, HrU, HrT,
      zeros ;

  this.bit_field.fill(0) ;
  
  HrT    = time[0] / 10 ;
  HrU    = time[0] % 10 ;
  MinT   = time[1] / 10 ;
  MinU   = time[1] % 10 ;
  SecT   = time[2] / 10 ;
  SecU   = time[2] % 10 ;
  FrameT = time[3] / 10 ;
  FrameU = time[3] % 10 ;
  
  // first short
  this.bit_field[0] |= ( FrameU << 12 ) ;
  this.bit_field[0] |= ( FrameT <<  6 ) ;
  this.bit_field[0] |= ( (ubits[0] & 0xF0) << 4 ) ;
  this.bit_field[0] |= ( (ubits[0] & 0x0F) ) ;
  this.bit_field[0] |= ( (dff) << 5 ) ;
  // 2nd short
  this.bit_field[1] |= ( SecU << 12 ) ;
  this.bit_field[1] |= ( SecT <<  5 ) ;
  this.bit_field[1] |= ( (ubits[1] & 0xF0) << 4 ) ;
  this.bit_field[1] |= ( (ubits[1] & 0x0F) ) ;
  // 3rd short
  this.bit_field[2] |= ( MinU << 12 ) ;
  this.bit_field[2] |= ( MinT <<  5 ) ;
  this.bit_field[2] |= ( (ubits[2] & 0xF0) << 4 ) ;
  this.bit_field[2] |= ( (ubits[2] & 0x0F) ) ;
  // 4th short
  this.bit_field[3] |= ( HrU << 12 ) ;
  this.bit_field[3] |= ( HrT <<  6 ) ;
  this.bit_field[3] |= ( (ubits[3] & 0xF0) << 4 ) ;
  this.bit_field[3] |= ( (ubits[3] & 0x0F) ) ;
  
  // count the zeros for parity
  // cast as array buff
  var test = new Uint8Array(this.bit_field.buffer) ;
  zeros = this.compByteParity( test[0] ) ;
  for( var i = 1; i<9; i++ ) {
    zeros ^= this.compByteParity( test[i] ) ;
  }
  // known to be odd in the SYNC_CODE, but the above check is for even parity
  // so XORing with 1 is like ¬zeros XOR 0.
  zeros ^= 1 ;
  // attach parity
  this.bit_field[1] |= ( zeros <<  4 ) ;
  
  // attach SYNC word
  this.bit_field[4] = LTC.SYNC_FLAG ;
  
} ; // makeBF

GEN.makeBits = function() {
  var masks = new Uint8Array( [ 0x80, 0x40, 0x20, 0x10,
                                0x08, 0x04, 0x02, 0x01 ] ) ;
  var b_buf = new Uint8Array( this.bit_field.buffer ) ;
  var num_bytes = b_buf.length ;
  var num_masks = masks.length ;
  var bits = [] ;
  for( var i = 0; i < num_bytes; i++ ) {
    for( var j = 0; j < num_masks; j++ ) {
      bits.push( (b_buf[i] & masks[j])?1:0 ) ;
    }
  }
  return bits ;
} ; // makeBits


function BiPhaseDecoder() {
  // gaps
  this.last_B_period = 0.0 ;
  this.this_period   = 0.0 ;
  this.big_periods   = 0.0 ;
  this.small_periods = 0.0 ;
  // FSM
  this.in_long_gap   = false ;
  this.in_first_half = false ;
  // booting
  this.till_booted   = 32 ; // arbitrary
  // The bit I'm decoding
  this.bit           = -1 ;

  // register Event
  this.bitEvent = function(){};
}

// process
BiPhaseDecoder.prototype.tick = function( event_data ) {
  // get the time since last crossing
  this.this_period = (event_data.time - event_data.lastTime) ;
  // determine if it's a long or short period
  // cf: http://www.avrfreaks.net/forum/tut-pc-avr-softunderstanding-bi-phase-mark-coding
  // "If it's more than 3/4 of the bit period, you've just received a zero;
  // otherwise, you got half of a one."
  // Note: by only ever comparing current period to long-ifyied last period, we
  // can tolerate increases in speed of transmission, if gradual; and need no
  // a priori data on expected rate / samps per sec.
  if( (this.this_period * 4.0) > (this.last_B_period * 3.0) ) {
    // this is a long period
    this.last_B_period = this.this_period ;
    this.in_long_gap   = true ;
    // get stats
    this.big_periods += this.this_period ;
    this.big_periods *= 0.5 ;
  } else {
    // otherwise a short period
    this.last_B_period = this.this_period * 2.0 ; // last_B_period is always big
    this.in_long_gap   = false ;
    // get stats
    this.small_periods += this.this_period ;
    this.small_periods *= 0.5 ;
  } // if this_period > (3/4 * last_B_period)

  // a long gap == bit 0; or two short gaps == bit 1
  if( this.in_long_gap ) {
    this.in_first_half = false ;
    this.bit = 0 ;
  } else {
    if (this.in_first_half) {
      this.in_first_half = false ;
      this.bit = 1 ;
    } else {
      this.in_first_half = true ;
      this.bit = -1 ; // not ready to TX yet
    }
  } // if in_long_gap
  
  if( this.till_booted < 0 ) {
    // emit the bit if ready
    if( (this.bit >= 0) ) {
      this.bitEvent( this.bit ) ;
    }
  } else {
    // it will take some time to get a good sampling of big and small periods
    this.till_booted-- ;
    // keep flushing the stats till it stabilizes
    this.big_periods   = 0.0 ;
    this.small_periods = 0.0 ;
    // possibly, 'if( Math.abs( (small * 2.0) - big ) < 1e-5 ) till_booted = -1 ;'
  } // if booted
} ;

BiPhaseDecoder.prototype.tick2 = function( e ) {
  // get the time since last crossing
  this.this_period = (e.time - e.lastTime) ;
  // if( (this.this_period << 2) > (this.last_B_period * 3) ) { // if time is int
  if( (this.this_period * 1.333) > (this.last_B_period) ) { // if time is float
    // this is a long period
    this.last_B_period = this.this_period ;
    this.bit = 0 ;
  } else {
    // otherwise a short period
    this.last_B_period = this.this_period * 2 ; // or << 1 if int
    // short period so if last was short, this is 1, else it's first half
    this.bit = (this.bit<0) ? 1 : -1 ; // this clause makes for nice ASM
  } // if this_period * 4/3 > last_B_period

  
  if( this.till_booted < 0 ) {
    // emit the bit if ready
    if( (this.bit >= 0) ) {
      this.bitEvent( this.bit ) ;
    }
  } else {
    // it will take some time to get a good sampling of big and small periods
    --this.till_booted ;
  } // if booted
} ;

////////////////////////////////////////////////////////////////////////

// init tests
BMCman = new BiPhaseDecoder() ;
TC = new TimeCode() ;
LTC = new LTCDecoder() ;


test1 = function(){
  // using simulated bit stream, accumulate in the LTC object
  // and decode when SYNC found
  var boolaments = [0,1,1,1, 1,1,0,1, 0,0,     0,   0, 1,1,1,0,
                  //  Fu   ,   Ub1  , Ft ,   Dff, Cff,   Ub2  ,
                    0,1,1,0, 1,0,1,0, 1,0,1,   0,      1,1,0,1,
                  //  Su   ,   Ub3  ,  St  ,   p,        Ub4  ,
                    0,1,0,0, 1,0,1,1, 0,1,1,   1,      1,1,1,0,
                  //  Mu   ,   Ub5  ,  Mt  , BF1,        Ub6  ,
                    0,0,1,0, 1,1,1,0, 0,1,     0,   0, 1,1,1,1,
                  //  Hu   ,   Ub7  , Ht ,  zero, BF2,   Ub 8 ,
                    0,0,1,1, 1,1,1,1, 1,1,1,1,         1,1,0,1];
                  // SYNC WORD

  var len = boolaments.length ;
  for( var i = 0; i<len; i++ ) {
    LTC.appendBit( boolaments[ i ] ) ;
    if( LTC.IsSyncPoint() ){
      print( "Tick" ) ;
      TC.setFromBF( LTC.bit_field ) ;
      TC.display(0) ;
    }
  } // for
} ;

test2 = function() {
  // test creating a bit_field from give time and ubit data.
  time  = new Uint8Array( [ 1, 19, 52, 23] ) ;
  ubits = new Uint8Array( [0x16, 0x6, 0x17, 0x29] ) ;
  GEN.makeBF( time, ubits, 0 ) ;
  print( GEN.bit_field ) ;
  TC.setFromBF( GEN.bit_field ) ;
  TC.display(0) ;
} ;

test3 = function() {
  // put it all together...
  BMCman.bitEvent = LTC.appendBit ;
  LTC.syncEvent = function() {
    digitalWrite( LED1, 1 ) ; // blink on sync.
    TC.setFromBF( LTC.bit_field ) ;
    TC.display(1) ; // just log the TC
    if( (TC.rate < 0) && (LTC.frame_count > 100) ) {
      // compute the rate
      TC.setRateFromBF( BMCman.big_periods ) ;
    }
    setTimeout( 'digitalWrite(LED1,0);', 1 ) ;
  } ;
  setWatch( BMCman.tick, A0, {repeat:true, edge:'both'} ) ;
} ;