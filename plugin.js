/*
 * Copyright (C) 2003-2011 CKSource - Frederico Knabben
 * Plugin for CKEditor to send the current data to the server so it can be saved automatically.
 *
 * File Author:
 *   Jakub Świderski
 *
 * How to Use & Change log: docs/install.html
 *
 * == BEGIN LICENSE ==
 *
 * Licensed under the terms of any of the following licenses at your
 * choice:
 *
 *  - GNU General Public License Version 2 or later (the "GPL")
 *    http://www.gnu.org/licenses/gpl.html
 *
 *  - GNU Lesser General Public License Version 2.1 or later (the "LGPL")
 *    http://www.gnu.org/licenses/lgpl.html
 *
 *  - Mozilla Public License Version 1.1 or later (the "MPL")
 *    http://www.mozilla.org/MPL/MPL-1.1.html
 *
 * == END LICENSE ==
 *
 */

( function()
{
	// Counts number of times when editor was dirty.
	var Counter = 0;

	//Remembers state of Counter in case of an error
	var CounterPrevious = 0;

	// Flag indicating if button 'ajaxautosave' was pressed.
	var ButtonUsed = false;

	// Flag indicating if 'ajaxautosave' interval was fired.
	var IntervalUsed = false;

	// Flag indicating whether editor contents are being saved at the moment.
	var Working = false;

	// Holds array of icon-message pairs.
	var Icons = '';

	// Holds the name of "ajaxautosave" interval (used in window.clearInterval).
	var Interval = '';

	// Time of last successful save. It is set by AJAX on success save.
	var LastSave = '';

	// Hook to timeout used to set default/dirty icon (used in
	// window.clearTimeout).
	var TimeoutDefaultDirtyIcon = '';

	// Hook to timeout used to abort client-side request (used in window.clearTimeout).
	var TimeoutRequest = '';

	// Flag indicating if min time between two requests has passed.
	var IsMinTimeBetweenRequests = true;

	// Hook to timeout used to count time between requests (used in window.clearTimeout).
	var TimeoutBetweenRequests = '';

	//Flag indicating if keystroke was added.
	var KeystrokeAdded = false;

	var TestPattern =  /^form$|^body$/i;

	var TestPatternSmall =  /^form$/i;

	// Ajax object handler.
	var ajaxautosaveAjax = ( function()
	{

		// private
		var _editor = null;

		var _doBasicActions = function( editorInstance, targetUrl )
		{
			if ( !targetUrl )
			{
				// show error, set timeout for dirty icon and throw an exception.
				ajaxautosaveChangeIcon( editorInstance, Icons[5].path,
					Icons[5].title
						+ editorInstance.lang.ajaxautosave.noUrl );

				window.clearTimeout( TimeoutDefaultDirtyIcon );

				TimeoutDefaultDirtyIcon = CKEDITOR.tools.setTimeout(
					ajaxautosaveChangeIcon, 5000, null, [ editorInstance,
							Icons[1].path, Icons[1].title ] );

				throw new Error( editorInstance.lang.ajaxautosave.noUrl );
			}
			_editor = editorInstance;
		};

		/**
		* The first time this method is called, it will test three different
		* ways of creating an XHR object, and when it finds one that works, it
		* will return the object created and overwrite itself with the function
		* used to create the object. This new function becomes the _createXhrObj
		* method.
		*/
		var _createXhrObj = ( function()
		{ // Factory method.
			var methods = [
				function()
				{
					return {
						xhr : new XMLHttpRequest(),
						xhrTimeout : false
					};
				},
				function()
				{
					return {
						xhr : new ActiveXObject( 'Msxml2.XMLHTTP' ),
						xhrTimeout : false
					};
				},
				function()
				{
					return {
						xhr : new ActiveXObject( 'Microsoft.XMLHTTP' ),
						xhrTimeout : false
					};
				}
			];

			for ( var i = 0, len = methods.length ; i < len ; i++ )
			{
				try
				{
					methods[i]();
				}
				catch ( e ) { continue; }
				// If we have reached this point, method[i] worked.
				_createXhrObj = methods[i];
				return methods[i];
			}

			// If we have reached this point, none of the methods worked.
			throw new Error( _editor.lang.ajaxautosave.noXhr );
		} )();

		var _encodeGetParams = function( getUrl )
		{
			// get query string.
			var helper = ( getUrl.split( "?" ) )[1];
			// if there were no params return URL.
			if ( !helper )
				return getUrl;
			var encodedQueryString = _encodeParams( helper );
			getUrl = getUrl.replace( /\?.*/, "?" + encodedQueryString );
			return getUrl;
		};

		var _encodeParams = function( requestParams )
		{
			var helper = requestParams.split( "&" );
			var encodedQueryString = '';
			for ( var w = 0, len = helper.length ; w < len ; w++ )
			{
				// contents are already encoded
				if ( helper[w].substring( 0, helper[w].indexOf( "=" ) ) != _editor.config.ajaxautosave.ContentParamName )
					helper[w] = helper[w].replace( /\=.*/, "="
						+ encodeURIComponent( helper[w].substring( helper[w]
							.indexOf( "=" ) + 1 ) ) );
				encodedQueryString += ( w === 0 ? "" : "&" ) + helper[w];
			}
			return encodedQueryString;
		};

		// Handles common errors like error404 or error500.
		// More messages can be added in language files.
		var _handleError = function( errorCode, xhrStatusText )
		{
			var message = '';
			message = _editor.lang.ajaxautosave['error'+errorCode];
			if(!message){
				if ( xhrStatusText )
				{
					message =
					 '(' + errorCode + ') ' + xhrStatusText ;
				} else
				{
					message = _editor.lang.ajaxautosave.defaultErrorMessage
						.replace( /(###)/, errorCode );
				}
			}


			ajaxautosaveChangeIcon( _editor, Icons[5].path,
				Icons[5].title + message );
		};

		// Gets time on client-side to tell user when
		// his data was saved. Server date can't be used in this case.
		var _getTimeOnClinetSide = function()
		{
			var now = new Date();
			var hours = now.getHours();
			var mins = now.getMinutes();
			var secs = now.getSeconds();
			if ( hours < 10 )
				hours = "0" + hours;
			if ( mins < 10 )
				mins = "0" + mins;
			if ( secs < 10 )
				secs = "0" + secs;
			return ( hours + ':' + mins + ':' + secs );
		};

		// Returns appropriate icon when error occurred.
		var _getTimeoutParameters = function( isPath, isDirty )
		{
			if ( isPath )
				return ( isDirty ? Icons[1].path
					: Icons[0].path );
			else
				return ( isDirty ? Icons[1].title
					 : Icons[0].title + LastSave);
		};

		// privileged
		return {
			request : function( editorInstance, method, targetUrl, requestParams )
			{
				_doBasicActions( editorInstance, targetUrl );
				var xhrObject = _createXhrObj();

				xhrObject.xhr.onreadystatechange = function()
				{
					xhrObject.xhrTimeout = false;
					if ( _editor.config.ajaxautosave.RequestTimeout )
					{
						if ( xhrObject.xhr.readyState == 1 )
						{
							TimeoutRequest = window.setTimeout(
								function()
								{
									if ( xhrObject.xhr.readyState == 1
										|| ( xhrObject.xhr.readyState == 2 && CKEDITOR.env.opera ) )
									{
										xhrObject.xhr.abort(); // Stop
										xhrObject.xhrTimeout = true;

										ajaxautosaveChangeIcon( _editor, Icons[5].path,
											Icons[5].title
												+ _editor.lang.ajaxautosave.requestTimeout );

										window.clearTimeout( TimeoutDefaultDirtyIcon );

										TimeoutDefaultDirtyIcon = CKEDITOR.tools
										.setTimeout( checkAndRestoreIcon, 10000, null,
											[ _editor, _getTimeoutParameters( true, CounterPrevious ),
												_getTimeoutParameters( false, CounterPrevious ) ] );

										// ajax is not working anymore.
										Working = false;
										if(CounterPrevious)
											Counter += CounterPrevious;
									}
								}, _editor.config.ajaxautosave.RequestTimeout * 1000 );
						}
					}

					if ( xhrObject.xhr.readyState == 4 && !xhrObject.xhrTimeout )
					{
						// HTTP Status Codes:
						  //  2xx : Success
						  //  304 : Not Modified
						  //    0 : Returned when running locally (file://)
						  // 1223 : IE may change 204 to 1223 (see http://dev.jquery.com/ticket/1450)
						if ( ( xhrObject.xhr.status >= 200 && xhrObject.xhr.status < 300 ) ||
							xhrObject.xhr.status == 304 || xhrObject.xhr.status === 0
							||  xhrObject.xhr.status == 1223 )
						{
							if ( _editor.config.ajaxautosave.RequestTimeout )
								window.clearTimeout( TimeoutRequest );

							var status = '';
							var err = '';
							
							/** **/
							if(xhrObject.xhr.responseText){
								
								var ret = JSON.parse(xhrObject.xhr.responseText);
							
								status = ret["status"];
								err = ret["error"];
								//err = ret["error"]['message' => string, 'statuscode' => int ];
							}

							// <result status="ok" />
							if ( ( status == 'ok' ) )
							{
								LastSave = _getTimeOnClinetSide();

								ajaxautosaveChangeIcon( _editor, Icons[4].path,
									Icons[4].title + LastSave );

								window.clearTimeout( TimeoutDefaultDirtyIcon );

								TimeoutDefaultDirtyIcon = CKEDITOR.tools
									.setTimeout( checkAndRestoreIcon, 5000,
										null, [ _editor, Icons[0].path,
												Icons[0].title + LastSave
											  ] );

								CounterPrevious = 0;

							} else if ( err )
							{
								
								if ( err['message'] )
								{
									// if message form server was provided.
									ajaxautosaveChangeIcon(	_editor, Icons[5].path,  Icons[5].title, err['message']);
								} else
								{
									// if only error number was provided.
									_handleError( err['statuscode'] );
								}
								
								window.clearTimeout( TimeoutDefaultDirtyIcon );

								TimeoutDefaultDirtyIcon = CKEDITOR.tools
								.setTimeout( checkAndRestoreIcon, 10000, null,
									[ _editor, _getTimeoutParameters( true, CounterPrevious ),
										_getTimeoutParameters( false, CounterPrevious ) ] );
							} else
							{
								// No XML or not expected XML provided; we assume it is an error.
								// Use responseText object because even if the response is XML, plugin
								// won't be able to read it.
								ajaxautosaveChangeIcon( _editor, Icons[5].path,
									Icons[5].title
										+ ( ( xhrObject.xhr.responseText ) ? xhrObject.xhr.responseText
											: ( ( xhrObject.xhr.status ) ? _editor.lang.ajaxautosave.defaultErrorMessage
												.replace( /(###)/, xhrObject.xhr.status )
												: _editor.lang.ajaxautosave.unknownError ) ) );

								window.clearTimeout( TimeoutDefaultDirtyIcon );

								TimeoutDefaultDirtyIcon = CKEDITOR.tools
								.setTimeout( checkAndRestoreIcon, 10000, null,
									[ _editor, _getTimeoutParameters( true, CounterPrevious ),
										_getTimeoutParameters( false, CounterPrevious ) ] );
							}
						} else
						{
							// Inform about XML request error and try to set default icon.
							// Use responseText object because even if the response is XML, plugin
							// won't be able to read it.
							_handleError( xhrObject.xhr.status, xhrObject.xhr.responseText );

							window
								.clearTimeout( TimeoutDefaultDirtyIcon );

							TimeoutDefaultDirtyIcon = CKEDITOR.tools
							.setTimeout( checkAndRestoreIcon, 10000, null,
								[ _editor, _getTimeoutParameters( true, CounterPrevious ),
									_getTimeoutParameters( false, CounterPrevious ) ] );
						}
						// ajax is not working anymore.
						Working = false;
						if(CounterPrevious)
							Counter += CounterPrevious;
						editorInstance.fire( 'afterAutosave' );
					}

				};

				if ( method == 'GET' )
				{	// if GET, join data with URL.

					// URL might already have params.
					targetUrl = ( ( targetUrl.indexOf( "?" ) > 0 ) ? ( targetUrl
						+ '&' + requestParams ) : ( targetUrl + '?' + requestParams ) );
					// encode request params. All except for contents as
					// they were already encoded.
					targetUrl = _encodeGetParams( targetUrl );
					requestParams = null;
				}

				xhrObject.xhr.open( method, targetUrl, true );

				//if POST we assume there is only URL and no queryString attached.
				if ( method == 'POST' )
				{
					xhrObject.xhr.setRequestHeader( 'Content-Type',
						'application/x-www-form-urlencoded; charset=UTF-8' );
					// encode request params. All except for contents as
					// they were already encoded.
					requestParams = _encodeParams( requestParams );
				}
				editorInstance.fire( 'beforeAutosave' );
				xhrObject.xhr.send( requestParams );
			}
		};

	} )();

	function ajaxautosaveEnable( editor )
	{
		// Neither ajaxautosave button nor interval should update counter.
		if ( editor.checkDirty() )
		{
			Counter++ ;
			editor.resetDirty();
			// change Icon to saveDirty
			ajaxautosaveChangeIcon( editor, Icons[1].path,
				Icons[1].title );
		}

		// if content is being saved at the moment don't do anything.
		if ( !Working )
		{
			Working = true;
			if ( ButtonUsed || IntervalUsed )
			{
				if ( IntervalUsed )
				{
					IntervalUsed = false;
					// don't bother server with unnecessary requests.
					if ( Counter > 0
						&& IsMinTimeBetweenRequests)
					{
						invokeExecute( editor );
					} else
					{
						Working = false;
					}
				} else
				{
					// button is user decision to send request no checking is needed
					ButtonUsed = false;
					invokeExecute( editor );
				}
			} else if ( editor.config.ajaxautosave.Sensitivity
						&& Counter >= editor.config.ajaxautosave.Sensitivity )
			{
				if( IsMinTimeBetweenRequests )
				{
					window.clearTimeout( TimeoutBetweenRequests );//just in case
					IsMinTimeBetweenRequests = false;
					invokeExecute( editor );// for all events.
				} else
				{
					Working = false;
				}

			}else{
				Working = false;// nothing matches.

				//If only button works, reset counter after every non button saving attempt.
				if( !editor.config.ajaxautosave.Sensitivity
						&& !editor.config.ajaxautosave.RefreshTime)
					Counter = 0;
			}
		}

		// reset ButtonUsed if button was used and Working ==
		// true.
		if ( ButtonUsed )
		{
			ButtonUsed = false;
		}
	}

	function invokeExecute( editor )
	{
		var currentData = editor.getData(); // get editor's data.
		// remember counter in case of an error
		CounterPrevious = Counter;
		Counter = 0;// reset counter as early as possible.
		ajaxautosaveExecute( editor, currentData );
	}

	function ajaxautosaveExecute( editor, currentData )
	{
		// change icon to loading.
		ajaxautosaveChangeIcon( editor, Icons[3].path,
			Icons[3].title );

		cleanUserRequestParameters( editor, false );

		ajaxautosaveAjax.request( editor, editor.config.ajaxautosave.Method,
			editor.config.ajaxautosave.TargetUrl, editor.config.ajaxautosave.RequestParams
			+ 'ajaxautosaveaction=draft&ckeditorname=' + editor.name + '&' +
			editor.config.ajaxautosave.ContentParamName + '=' +
			encodeURIComponent( currentData ) );

		// set timeout between requests.
		window.clearTimeout( TimeoutBetweenRequests );
		IsMinTimeBetweenRequests = false;
		TimeoutBetweenRequests = window.setTimeout(
			function(){
				IsMinTimeBetweenRequests = true;
			},	editor.config.ajaxautosave.MinTimeBetweenRequests * 1000 );
	}

	function ajaxautosaveChangeIcon( editor, iconPath, description )
	{
		var ajaxautosaveButton = CKEDITOR.document
			.getById( editor.commands.ajaxautosave.uiItems[0]._.id );

		ajaxautosaveButton.getFirst().setStyle( 'background-image',
			'url(' + editor.plugins.ajaxautosave.path + iconPath + ')' );

		ajaxautosaveButton.setAttribute( 'title', description );
		// changes the value of label
		ajaxautosaveButton.getChild( 1 ).setHtml( description );
	}

	function endsWith( str, suffix ) {
	    return str.indexOf(suffix, str.length - suffix.length) !== -1;
	}


	// Removes leading and adds trailing ampersand sign.
	function cleanUserRequestParameters( editor, trimEnd ){
		if( editor.config.ajaxautosave.RequestParams ) {
			var helper = editor.config.ajaxautosave.RequestParams;
			var x = '&';

			// Remove all leading '&'.
			while( helper && helper.indexOf( x ) === 0 )
				helper = ( helper.length === 1 ? '' : helper.substring( 1 ) );

			if(trimEnd){// true only during init.
				// Remove all trailing '&'.
				while( helper && endsWith( helper, x ) )
					helper = helper.substring( 0, helper.length - 1 );
			}

			// Later assume there is none or only one '&' at the end.
			if ( helper && !endsWith( helper, x ) )
				helper += '&';

			editor.config.ajaxautosave.RequestParams = helper;
		}
	}

	// If editor was NOT modified since last save or error, this method changes
	// the icon to default (Otherwise there is no need of changing the icon).
	//Only default or dirty icon should be passed as parameter.
	//Counter!==CounterPrevious - icon was already changed to dirty
	//Working - icon was already changed to dirty
	//ajaxautosaveCheckDirty(editor) - icon was already changed to dirty
	function checkAndRestoreIcon( editor, iconPath, description )
	{
		if ( Counter === CounterPrevious && !Working && !editor.checkDirty() )
			ajaxautosaveChangeIcon( editor, iconPath, description );
	}

	function addEvent( element, eventType, fn )
	{
		if ( element.addEventListener )
		{
			element.addEventListener( eventType, fn, false );
		} else if ( element.attachEvent )
		{
			element.attachEvent( 'on' + eventType, fn );
		}
	}

	// Method used when form is submitted.
	function onSave( editor )
	{
		// Don't fire auto save.
		Working = true;
		// don't fire beforeunload.
		editor.config.ajaxautosave.UseOnBeforeUnload = false;
		// cleanup.
		window.clearInterval( Interval );
		window.clearTimeout( TimeoutDefaultDirtyIcon );
		window.clearTimeout( TimeoutBetweenRequests );
		return true;
	}

	//Gets first element with specified class name
	function getElementByClassName( classname, node )
	{
		if( !node )
	        node = document.getElementsByTagName( 'body' )[0];
        var result = '';
		var regExp = new RegExp( '\\b' + classname + '\\b' );
        var elements = node.getElementsByTagName( '*' );
        for( var i=0, len=elements.length ; i<len ; i++ )
        {
        	if( regExp.test( elements[i].className ) )
        	{
	        	result = elements[i];
	        	break; //break on first element found
        	}
        }
        return result;
    }

	// Checks if entered keystroke is already in table
	function containsKeystroke( arr, keystroke ) {
	    var i = arr.length;
	    while ( i-- ) {
	       if ( arr[ i ][ 0 ] === keystroke ) {
	           return true;
	       }
	    }
	    return false;
	}

	//Walks up the DOM tree until it
	//finds form or body element
	function getParentForm( elem )
	{
		if( !TestPattern.test( elem.nodeName ) )
		{
			return getParentForm( elem.parentNode );
		}else
		{
			if( TestPatternSmall.test( elem.nodeName ) )
				return elem;
			else
				return null;
		}
	}

	function attachOnKeydown( editor, event )
	{
		if ( editor.config.ajaxautosave.Keystroke && KeystrokeAdded )
		{
			if ( event.data.getKeystroke() === editor.config.ajaxautosave.Keystroke )
			{
				ButtonUsed = true;

				// Invoking execution of ajaxautosave command.
				editor.execCommand( 'ajaxautosave' );
				return;
			}
		}

		// Do not capture CTRL hotkeys.
		if ( event.data.$.ctrlKey || event.data.$.metaKey )
			return;

		var keyCode = event.data.$.keyCode;
		// Filter movement keys and related
		if ( keyCode == 8 || keyCode == 13 || keyCode == 32 ||
			( keyCode >= 46 && keyCode <= 90 ) ||
			( keyCode >= 96 && keyCode <= 111 ) ||
			( keyCode >= 186 && keyCode <= 222 ) )
				window.setTimeout( function()
				{
					ajaxautosaveEnable( editor );
				}, 100 );
	}

	CKEDITOR.plugins.add( 'ajaxautosave', {
		// List of available localizations.
		lang : [ 'en', 'pl' ],

		init : function( editor )
		{

			//Modify keystrokes as early as possible.
			editor.on( 'pluginsLoaded', function( evt )
			{
				// Add keystroke to CKEditor's keystroke table
				if ( editor.config.ajaxautosave.Keystroke )
				{
					var confKstr = editor.config.ajaxautosave.Keystroke;
					
					if ( ! editor.keystrokeHandler.keystrokes[ confKstr ] )
					{
		
						editor.setKeystroke( [ confKstr, 'ajaxautosave' ] );
						
						KeystrokeAdded = true;
					}
				}
			});

			// initialize events for CKEditor.
			editor.on( 'instanceReady', function( evt )
			{
				//Interval can't be smaller than min time between two following requests.
				//An exception from this rule is when interval is switched off (set to 0).
				if ( editor.config.ajaxautosave.RefreshTime &&
						parseInt( editor.config.ajaxautosave.RefreshTime, 10 ) <
						parseInt( editor.config.ajaxautosave.MinTimeBetweenRequests, 10 ) )
					editor.config.ajaxautosave.RefreshTime =
						editor.config.ajaxautosave.MinTimeBetweenRequests;

				cleanUserRequestParameters( editor, true );

				// Set several listeners to watch for changes to the content...

				// Fired whenever something changes.
				editor.on( 'saveSnapshot', function()
				{
					if ( !evt.data || !evt.data.contentOnly )
						ajaxautosaveEnable( editor );
				} );

				//Disable plugin when using CKEditor Save button.
				editor.on('beforeCommandExec', function(event){
					if( event.data.name == 'save' )
						onSave( editor );
				});

				// Fired on undo/redo.
				editor.getCommand( 'undo' ).on( 'afterUndo', function()
				{
					ajaxautosaveEnable( editor );
				} );
				editor.getCommand( 'redo' ).on( 'afterRedo', function()
				{
					ajaxautosaveEnable( editor );
				} );

				// catches changes in WYSIWYG mode.
				editor.on( 'contentDom', function( e )
				{
					editor.document.on( 'keydown', function( event )
					{
						attachOnKeydown( editor, event );
					} );
					editor.document.on( 'drop', function()
					{
						ajaxautosaveEnable( editor );
					} );
					editor.document.getBody().on( 'drop', function()
					{
						ajaxautosaveEnable( editor );
					} );
				} );
				// If you won't fire this event keydowns and drops won't work
				// until you switch to source and back.
				editor.fire( 'contentDom' );

				// Detect changes in source mode.
				editor.on( 'mode', function( e )
				{
					if ( editor.mode != 'source' )
						return;

					editor.textarea.on( 'keydown', function( event )
					{
						attachOnKeydown( editor, event );
					} );

					editor.textarea.on( 'drop', function()
					{
						ajaxautosaveEnable( editor );
					} );
					editor.textarea.on( 'input', function()
					{
						ajaxautosaveEnable( editor );
					} );
				} );

				// Fired after command execution; (We might say that it works
				// with non-dialog plugins).
				editor.on( 'afterCommandExec', function( event )
				{
					if ( event.data.name == 'source' )
						return;

					if ( event.data.command.canUndo !== false )
						ajaxautosaveEnable( editor );

				} );

				// Cleanup ondestroying instance of ckeditor.
				evt.editor.on( 'destroy', function( event )
				{
					window.clearInterval( Interval );
					window.clearTimeout( TimeoutDefaultDirtyIcon );
					window.clearTimeout( TimeoutBetweenRequests );
				} );

				// Activate 'ajaxautosave' disabling action for form submition.
				if ( editor.config.ajaxautosave.ParentFormId
					&& document
						.getElementById( editor.config.ajaxautosave.ParentFormId ) )
				{
					var form = document
						.getElementById( editor.config.ajaxautosave.ParentFormId );
					addEvent( form, 'submit', function()
					{
						onSave( editor );
					} );
				}else
				{
					var mainElement = getElementByClassName( editor.id );
					if( mainElement )
					{
						var formElement = getParentForm( mainElement );
						if( formElement ){
							addEvent( formElement, 'submit', function()
							{
								onSave( editor );
							} );
						}
					}
				}

				// Activate beforeunload.
				if ( editor.config.ajaxautosave.UseOnBeforeUnload )
				{
					window.onbeforeunload = function()
					{
						if ( editor.config.ajaxautosave.UseOnBeforeUnload )
						{
							if ( Counter > 0 || Working)
							{
								return editor.lang.ajaxautosave.looseChanges;
							}
						}
					};
				}

				// Activate interval.
				if ( editor.config.ajaxautosave.RefreshTime
					&& !parseInt( editor.config.ajaxautosave.RefreshTime, 10 ) < 1 )
				{
					Interval = window.setInterval( function()
					{
						IntervalUsed = true;
						ajaxautosaveEnable( editor );
					}, editor.config.ajaxautosave.RefreshTime * 1000 );
				}

				// Cleanup.
				window.onunload = function()
				{
					window.clearInterval( Interval );
					window.clearTimeout( TimeoutDefaultDirtyIcon );
					window.clearTimeout( TimeoutBetweenRequests );
					window.onbeforeunload = null;
				};
			} );

			// Set icon-message pairs.
			Icons = [
			{
				path : 'images/autosaveClean.gif',
				title : editor.lang.ajaxautosave.draftSaved
			},
			{
				path : 'images/autosaveDirty.gif',
				title : editor.lang.ajaxautosave.needsSaving
			},
			{
				path : 'images/loadingBig.gif',
				title : editor.lang.ajaxautosave.inProgress
			},
			{
				path : 'images/loadingSmall.gif',
				title : editor.lang.ajaxautosave.inProgress
			},
			{
				path : 'images/tick_animated.gif',
				title : editor.lang.ajaxautosave.draftSaved
			},
			{
				path : 'images/cross_animated.gif',
				title : editor.lang.ajaxautosave.errorTemplate
			} ];

			// Register plugin command.
			editor.addCommand( 'ajaxautosave', {

				modes : { wysiwyg:1, source:1 },

				canUndo : false,

				// Contains method to be executed for ajaxautosave on button
				// click, time interval or events.
				exec : function( editor )
				{
					ajaxautosaveEnable( editor );
				}
			} );

			editor.ui.addButton( 'Autosave', {
				label : editor.lang.ajaxautosave.defaultMessage,

				command : 'ajaxautosave',

				click : function( editor )
				{
					ButtonUsed = true;

					// Invoking execution of ajaxautosave command.
					editor.execCommand( 'ajaxautosave' );
				},

				toolbar: 'ajaxautosave,10',
				
				icon : this.path + 'images/autosaveClean.gif'
			} );
		}
	} );
} )();

// Extend CKEditor configuration options.
CKEDITOR.tools.extend( CKEDITOR.config, {
	ajaxautosave: {
		
		// Informs after how many changes made in the editor’s data
		//  should be fired. If set to zero this trigger will not be used.
		// Default value is 20.
		Sensitivity : 20,
	
		// Time in seconds after which  will fire.
		// If set to zero, interval will not be used (it will be switched off).
		// Default value is 30.
		// NOTE: If not set to zero then the value for this property
		// can be either bigger or equal to MinTimeBetweenRequests.
		RefreshTime : 30,
	
		// Specifies if onbeforeunload event should be used.
		// If user has changed editor data which haven’t yet been
		// saved and he/she wants to leave the page, browser will
		// ask him if he really wants to leave without saving the data.
		// Default value is true.
		UseOnBeforeUnload : true,
	
		// Target url (required). URL for connector handling the
		// request on server side E.g.
		// http://192.168.1.100:8080/AjaxAutosave/cksource/connector/java/connector.java
		TargetUrl : '',
	
		// Id of parent form element containing the editor instance.
		// If specified, plugin will be disabled when form is submitted.
		// Default value is empty string.
		// NOTE: If id is not specified, plugin will try to search for the
		// parent form element and attach the same events as when id for the
		// form is given.
		ParentFormId : '',
	
		// Method used to send request. Only POST and GET are supported.
		// Default value is POST.
		Method : 'POST',
	
		// Name of parameter, holding editor data, to use in GET or POST request.
		// Default value is ‘content’.
		ContentParamName : 'content',
	
		// User specific request parameters in form of querystring
		// E.g. someName=false&someName2=someValue&someName3=5
		// NOTE: This queryString should not start with ampersand sign.
		// Default value is empty string.
		RequestParams : '',
	
		// Key shortcut for button used to invoke  action.
		// It is treated the same way as if button was pressed (no counter
		// checks are made). Specify the shortcut and plugin will add it to
		// CKEditor's keystroke table.
		// http://docs.cksource.com/ckeditor_api/symbols/CKEDITOR.config.html#.keystrokes
		// NOTE: Shortcut will be added only if it does not exists in keystroke table.
		// Example value CKEDITOR.CTRL + 83 (CRTL+S). Default value is empty string.
		Keystroke : '',
	
		// Time in seconds after which client-side request will timeout if it is not
		// yet finished on server-side. If set to zero timeout for client-side request
		// will not be used. Default value is 10.
		// NOTE: This only aborts the client-side request so that application on browser
		// side could return to its default state.
		RequestTimeout : 10,
	
		// Minimum amount of time in seconds which has to pass before another request
		// is send to server. Default value is 15.
		MinTimeBetweenRequests : 15
	}
} );
